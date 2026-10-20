package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const protocol = "neko-vm-v1"
const maxFrame = 262144
const chunkBytes = 65536
const maxFrames = 20000
const maxInput = 64 * 1024 * 1024
const maxOutput = 16 * 1024 * 1024
const maxLog = 1024 * 1024

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var hashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var errProtocol = errors.New("protocol-error")

type incoming map[string]json.RawMessage

func decodeFrame(line []byte) (incoming, error) {
	if len(line) > maxFrame || !utf8.Valid(line) {
		return nil, errProtocol
	}
	d := json.NewDecoder(bytes.NewReader(line))
	first, e := d.Token()
	if e != nil || first != json.Delim('{') {
		return nil, errProtocol
	}
	m := incoming{}
	for d.More() {
		key, e := d.Token()
		if e != nil {
			return nil, errProtocol
		}
		k, ok := key.(string)
		if !ok {
			return nil, errProtocol
		}
		if _, exists := m[k]; exists {
			return nil, errProtocol
		}
		var v json.RawMessage
		if d.Decode(&v) != nil {
			return nil, errProtocol
		}
		m[k] = v
	}
	if end, e := d.Token(); e != nil || end != json.Delim('}') {
		return nil, errProtocol
	}
	if _, e := d.Token(); e != io.EOF {
		return nil, errProtocol
	}
	return m, nil
}
func str(m incoming, k string) string {
	var value string
	if json.Unmarshal(m[k], &value) != nil {
		return ""
	}
	return value
}
func integer(m incoming, k string) (int64, bool) {
	var v int64
	e := json.Unmarshal(m[k], &v)
	return v, e == nil
}
func exact(m incoming, keys ...string) bool {
	if len(m) != len(keys) {
		return false
	}
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			return false
		}
	}
	return true
}
func safePath(p string) bool {
	if p == "" || len(p) > 4096 || !utf8.ValidString(p) || strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\\\x00\r\n") {
		return false
	}
	for _, part := range strings.Split(p, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return path.Clean(p) == p
}
func conflict(a, b string) bool {
	return a == b || strings.HasPrefix(a, b+"/") || strings.HasPrefix(b, a+"/")
}
func decodeChunk(s string) ([]byte, error) {
	if len(s) == 0 || len(s) > 4*((chunkBytes+2)/3) {
		return nil, errProtocol
	}
	data, e := base64.StdEncoding.Strict().DecodeString(s)
	if e != nil || len(data) == 0 || len(data) > chunkBytes || base64.StdEncoding.EncodeToString(data) != s {
		return nil, errProtocol
	}
	return data, nil
}

type transfer struct {
	path  string
	mode  int64
	size  int64
	hash  string
	bytes []byte
}
type agent struct {
	workspace       string
	reader          *bufio.Reader
	writer          io.Writer
	actionID, nonce string
	mu              sync.Mutex
	outputError     error
	outputFrames    int
	logBytes        int
	truncated       [2]bool
	files           map[string]bool
	open            *transfer
	inputBytes      int64
	inputFrames     int
	started         bool
	overflow        chan struct{}
	overflowOnce    sync.Once
}

func newAgent(root string, r io.Reader, w io.Writer) *agent {
	return &agent{workspace: root, reader: bufio.NewReaderSize(r, maxFrame+1), writer: w, files: map[string]bool{}, overflow: make(chan struct{})}
}
func (a *agent) emit(kind string, fields map[string]any) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.emitLocked(kind, fields)
}
func (a *agent) emitLocked(kind string, fields map[string]any) error {
	if a.outputError != nil {
		return a.outputError
	}
	if a.outputFrames >= maxFrames {
		return errProtocol
	}
	a.outputFrames++
	fields["protocol"] = protocol
	fields["type"] = kind
	fields["actionId"] = a.actionID
	fields["nonce"] = a.nonce
	b, e := json.Marshal(fields)
	if e != nil || len(b)+1 > maxFrame {
		return errProtocol
	}
	b = append(b, '\n')
	if bounded, ok := a.writer.(interface{ SetWriteDeadline(time.Time) error }); ok {
		_ = bounded.SetWriteDeadline(time.Now().Add(5 * time.Second))
	}
	_, e = a.writer.Write(b)
	if e != nil {
		a.outputError = e
	}
	return e
}
func (a *agent) log(which int, data []byte) {
	a.mu.Lock()
	defer a.mu.Unlock()
	space := maxLog - a.logBytes
	if len(data) > space {
		a.truncated[which] = true
		a.overflowOnce.Do(func() { close(a.overflow) })
		data = data[:space]
	}
	if len(data) == 0 {
		return
	}
	a.logBytes += len(data)
	name := "stdout"
	if which == 1 {
		name = "stderr"
	}
	_ = a.emitLocked(name, map[string]any{"dataBase64": base64.StdEncoding.EncodeToString(data)})
}
func (a *agent) read() (incoming, error) {
	if a.inputFrames >= maxFrames {
		return nil, errProtocol
	}
	a.inputFrames++
	line, e := a.reader.ReadSlice('\n')
	if e != nil || len(line) > maxFrame {
		return nil, errProtocol
	}
	return decodeFrame(line[:len(line)-1])
}
func (a *agent) result(code *int, signal *int, outputs []string, reason any) error {
	a.mu.Lock()
	truncated := a.truncated
	a.mu.Unlock()
	return a.emit("result", map[string]any{"exitCode": code, "signal": signal, "outputs": outputs, "stdoutTruncated": truncated[0], "stderrTruncated": truncated[1], "errorCode": reason})
}
func (a *agent) run() error {
	hello, e := a.read()
	if e != nil || !exact(hello, "protocol", "type", "actionId", "nonce") || str(hello, "protocol") != protocol || str(hello, "type") != "hello" || !uuidPattern.MatchString(str(hello, "actionId")) || !hashPattern.MatchString(str(hello, "nonce")) {
		return errProtocol
	}
	a.actionID = str(hello, "actionId")
	a.nonce = str(hello, "nonce")
	if e = a.emit("ready", map[string]any{"agentVersion": 1, "architecture": "arm64", "capability": "linux-shell"}); e != nil {
		return e
	}
	for {
		frame, e := a.read()
		if e != nil {
			_ = a.result(nil, nil, []string{}, "protocol-error")
			return errProtocol
		}
		if str(frame, "protocol") != protocol || str(frame, "actionId") != a.actionID || str(frame, "nonce") != a.nonce {
			_ = a.result(nil, nil, []string{}, "protocol-error")
			return errProtocol
		}
		kind := str(frame, "type")
		switch kind {
		case "file-begin":
			p := str(frame, "path")
			mode, okm := integer(frame, "mode")
			size, oks := integer(frame, "size")
			valid := exact(frame, "protocol", "type", "actionId", "nonce", "path", "mode", "size", "sha256") && a.open == nil && len(a.files) < 4096 && safePath(p) && okm && (mode == 0600 || mode == 0700) && oks && size >= 0 && size <= maxInput && a.inputBytes+size <= maxInput && hashPattern.MatchString(str(frame, "sha256"))
			for old := range a.files {
				if conflict(old, p) {
					valid = false
				}
			}
			if !valid {
				return a.fail("input-error")
			}
			a.open = &transfer{path: p, mode: mode, size: size, hash: str(frame, "sha256"), bytes: make([]byte, 0, int(size))}
		case "file-chunk":
			if !exact(frame, "protocol", "type", "actionId", "nonce", "path", "offset", "dataBase64") || a.open == nil || str(frame, "path") != a.open.path {
				return a.fail("input-error")
			}
			offset, ok := integer(frame, "offset")
			data, e := decodeChunk(str(frame, "dataBase64"))
			if !ok || e != nil || offset != int64(len(a.open.bytes)) || int64(len(a.open.bytes)+len(data)) > a.open.size {
				return a.fail("input-error")
			}
			a.open.bytes = append(a.open.bytes, data...)
		case "file-end":
			if !exact(frame, "protocol", "type", "actionId", "nonce", "path") || a.open == nil || str(frame, "path") != a.open.path {
				return a.fail("input-error")
			}
			file := a.open
			sum := sha256.Sum256(file.bytes)
			if int64(len(file.bytes)) != file.size || hex.EncodeToString(sum[:]) != file.hash {
				return a.fail("input-error")
			}
			if e = writeInput(a.workspace, file.path, file.bytes, os.FileMode(file.mode)); e != nil {
				return a.fail("input-error")
			}
			a.files[file.path] = true
			a.inputBytes += file.size
			a.open = nil
		case "execute":
			if !exact(frame, "protocol", "type", "actionId", "nonce", "script", "outputPaths", "timeoutMs") || a.started || a.open != nil {
				return a.fail("protocol-error")
			}
			script := str(frame, "script")
			timeout, ok := integer(frame, "timeoutMs")
			var paths []string
			if script == "" || len(script) > 65536 || strings.IndexByte(script, 0) >= 0 || !ok || timeout < 1 || timeout > 600000 || json.Unmarshal(frame["outputPaths"], &paths) != nil || paths == nil || len(paths) > 256 {
				return a.fail("protocol-error")
			}
			chosen := map[string]bool{}
			for _, p := range paths {
				if !safePath(p) || chosen[p] {
					return a.fail("output-error")
				}
				for old := range chosen {
					if conflict(old, p) {
						return a.fail("output-error")
					}
				}
				chosen[p] = true
			}
			a.started = true
			if e = assignWorkspace(a.workspace); e != nil {
				return a.fail("execution-error")
			}
			exit, signal, reason := runJob(a.workspace, script, timeout, a.log, func(which int) { a.mu.Lock(); a.truncated[which] = true; a.mu.Unlock() }, a.overflow)
			outputs, outputErr := a.capture(paths)
			if outputErr != nil && reason == nil {
				reason = "output-error"
				if outputErr.Error() == "output-limit" {
					reason = "output-limit"
				}
			}
			if e = a.result(exit, signal, outputs, reason); e != nil {
				return e
			}
			return nil
		default:
			return a.fail("protocol-error")
		}
	}
}
func (a *agent) fail(reason string) error {
	_ = a.result(nil, nil, []string{}, reason)
	return errors.New(reason)
}
func (a *agent) capture(paths []string) ([]string, error) {
	outputs := []string{}
	total := int64(0)
	for _, p := range paths {
		file, e := openOutput(a.workspace, p)
		if e != nil {
			return outputs, errors.New("output-error")
		}
		before, e := file.Stat()
		if e != nil || !before.Mode().IsRegular() || before.Size() < 0 || before.Size() > maxOutput || total+before.Size() > maxOutput {
			file.Close()
			return outputs, errors.New("output-limit")
		}
		data, e := io.ReadAll(io.LimitReader(file, maxOutput-total+1))
		after, afterErr := file.Stat()
		file.Close()
		if e != nil || afterErr != nil || int64(len(data)) != before.Size() || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) || int64(len(data))+total > maxOutput {
			return outputs, errors.New("output-error")
		}
		mode := int64(0600)
		if before.Mode()&0111 != 0 {
			mode = 0700
		}
		sum := sha256.Sum256(data)
		if e = a.emit("output-begin", map[string]any{"path": p, "mode": mode, "size": len(data), "sha256": hex.EncodeToString(sum[:])}); e != nil {
			return outputs, e
		}
		for at := 0; at < len(data); at += chunkBytes {
			end := at + chunkBytes
			if end > len(data) {
				end = len(data)
			}
			if e = a.emit("output-chunk", map[string]any{"path": p, "offset": at, "dataBase64": base64.StdEncoding.EncodeToString(data[at:end])}); e != nil {
				return outputs, e
			}
		}
		if e = a.emit("output-end", map[string]any{"path": p}); e != nil {
			return outputs, e
		}
		outputs = append(outputs, p)
		total += int64(len(data))
	}
	return outputs, nil
}
func main() {
	conn, e := listenGuest()
	if e != nil {
		fmt.Fprintln(os.Stderr, "guest-listener-unavailable")
		os.Exit(1)
	}
	defer conn.Close()
	if newAgent("/workspace", conn, conn).run() != nil {
		os.Exit(1)
	}
}
