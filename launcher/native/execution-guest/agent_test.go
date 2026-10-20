package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

const action = "11111111-1111-4111-8111-111111111111"

func frame(kind string, extras map[string]any) []byte {
	m := map[string]any{"protocol": protocol, "type": kind, "actionId": action, "nonce": strings.Repeat("a", 64)}
	for k, v := range extras {
		m[k] = v
	}
	b, _ := json.Marshal(m)
	return append(b, '\n')
}
func TestStrictFramesAndPaths(t *testing.T) {
	for _, raw := range []string{`{"type":"hello","type":"execute"}`, `[]`, `{} {}`, string([]byte{'{', '"', 'x', '"', ':', '"', 255, '"', '}'})} {
		if _, e := decodeFrame([]byte(raw)); e == nil {
			t.Fatalf("accepted malformed frame %q", raw)
		}
	}
	for _, p := range []string{"", "/root", "a/../b", "a//b", "a\\b", "a/./b", "a\x00b"} {
		if safePath(p) {
			t.Fatalf("accepted path %q", p)
		}
	}
	if !safePath("nested/result.txt") {
		t.Fatal("valid relative path refused")
	}
	if _, e := decodeChunk(""); e == nil {
		t.Fatal("empty chunk accepted")
	}
	if _, e := decodeChunk("Zh=="); e == nil {
		t.Fatal("noncanonical base64 accepted")
	}
}
func TestTransferIdentityAndOrdering(t *testing.T) {
	for _, bad := range [][]byte{
		frame("file-chunk", map[string]any{"path": "file", "offset": 0, "dataBase64": "YQ=="}),
		append(frame("file-begin", map[string]any{"path": "file", "mode": 384, "size": 1, "sha256": strings.Repeat("b", 64)}), frame("file-chunk", map[string]any{"path": "file", "offset": 1, "dataBase64": "YQ=="})...),
		frame("hello", nil),
	} {
		var out bytes.Buffer
		input := append(frame("hello", nil), bad...)
		a := newAgent(t.TempDir(), bytes.NewReader(input), &out)
		if a.run() == nil {
			t.Fatal("invalid transition accepted")
		}
		if !bytes.Contains(out.Bytes(), []byte(`"type":"ready"`)) || !bytes.Contains(out.Bytes(), []byte(`"type":"result"`)) {
			t.Fatal("missing scoped ready/error result")
		}
	}
}
func TestBoundedLogsAndExactReady(t *testing.T) {
	var out bytes.Buffer
	a := newAgent(t.TempDir(), bytes.NewReader(frame("hello", nil)), &out)
	_ = a.run()
	for at:=0;at<maxLog;at+=16384 { a.log(0, bytes.Repeat([]byte{'a'}, 16384)) }
	a.log(1, []byte("overflow"))
	if a.logBytes != maxLog || !a.truncated[1] {
		t.Fatal("log budget not enforced")
	}
	if a.outputFrames > maxFrames {
		t.Fatal("frame budget exceeded")
	}
	select {case <-a.overflow: default:t.Fatal("overflow did not request execution stop")}
}
