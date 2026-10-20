//go:build linux

package main

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type sockaddrVM struct {
	Family   uint16
	Reserved uint16
	Port     uint32
	CID      uint32
	Zero     [4]byte
}

func listenGuest() (io.ReadWriteCloser, error) {
	fd, e := syscall.Socket(40, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	defer syscall.Close(fd)
	addr := sockaddrVM{Family: 40, Port: 4041, CID: 0xffffffff}
	_, _, errno := syscall.Syscall(syscall.SYS_BIND, uintptr(fd), uintptr(unsafe.Pointer(&addr)), unsafe.Sizeof(addr))
	if errno != 0 {
		return nil, errno
	}
	if e = syscall.Listen(fd, 1); e != nil {
		return nil, e
	}
	// syscall.Accept4 converts the peer address through anyToSockaddr, which
	// does not support AF_VSOCK and closes an otherwise successfully accepted FD.
	accepted, _, acceptErr := syscall.Syscall6(syscall.SYS_ACCEPT4, uintptr(fd), 0, 0, uintptr(syscall.SOCK_CLOEXEC|syscall.SOCK_NONBLOCK), 0, 0)
	if acceptErr != 0 {
		return nil, acceptErr
	}
	return os.NewFile(accepted, "owned-vsock"), nil
}
func openParent(root, p string, create bool) (int, string, error) {
	fd, e := syscall.Open(root, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if e != nil {
		return -1, "", e
	}
	parts := strings.Split(p, "/")
	for _, part := range parts[:len(parts)-1] {
		if create {
			e = syscall.Mkdirat(fd, part, 0700)
			if e != nil && e != syscall.EEXIST {
				syscall.Close(fd)
				return -1, "", e
			}
		}
		next, e := syscall.Openat(fd, part, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
		syscall.Close(fd)
		if e != nil {
			return -1, "", e
		}
		fd = next
	}
	return fd, parts[len(parts)-1], nil
}
func writeInput(root, p string, data []byte, mode os.FileMode) error {
	fd, name, e := openParent(root, p, true)
	if e != nil {
		return e
	}
	defer syscall.Close(fd)
	out, e := syscall.Openat(fd, name, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, uint32(mode))
	if e != nil {
		return e
	}
	f := os.NewFile(uintptr(out), "input")
	defer f.Close()
	if _, e = f.Write(data); e != nil {
		return e
	}
	return f.Sync()
}
func openOutput(root, p string) (*os.File, error) {
	fd, name, e := openParent(root, p, false)
	if e != nil {
		return nil, e
	}
	defer syscall.Close(fd)
	out, e := syscall.Openat(fd, name, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	return os.NewFile(uintptr(out), "output"), nil
}
func assignWorkspace(root string) error {
	return filepath.Walk(root, func(p string, info os.FileInfo, e error) error {
		if e != nil {
			return e
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() && !info.Mode().IsRegular() {
			return errors.New("input-error")
		}
		return os.Chown(p, 1000, 1000)
	})
}
func runJob(root, script string, timeout int64, log func(int, []byte), truncate func(int), overflow <-chan struct{}) (*int, *int, any) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Millisecond)
	defer cancel()
	watchDone := make(chan struct{})
	defer close(watchDone)
	go func() {
		select {
		case <-overflow:
			cancel()
		case <-watchDone:
		}
	}()
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", script)
	cmd.Dir = root
	cmd.Env = []string{"HOME=/workspace", "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "LANG=C", "LC_ALL=C", "TMPDIR=/tmp"}
	cmd.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: 1000, Gid: 1000, Groups: []uint32{1000}}}
	outR, outW, e := os.Pipe()
	if e != nil {
		return nil, nil, "execution-error"
	}
	errR, errW, e := os.Pipe()
	if e != nil {
		outR.Close()
		outW.Close()
		return nil, nil, "execution-error"
	}
	cmd.Stdout = outW
	cmd.Stderr = errW
	cmd.Stdin = nil
	var wg sync.WaitGroup
	wg.Add(2)
	for which, reader := range []*os.File{outR, errR} {
		go func(which int, r *os.File) {
			defer wg.Done()
			buffer := make([]byte, 16384)
			for {
				n, e := r.Read(buffer)
				if n > 0 {
					log(which, buffer[:n])
				}
				if e != nil {
					return
				}
			}
		}(which, reader)
	}
	e = cmd.Start()
	outW.Close()
	errW.Close()
	if e != nil {
		outR.Close()
		errR.Close()
		wg.Wait()
		return nil, nil, "execution-error"
	}
	waitErr := cmd.Wait()
	drained := make(chan struct{})
	go func() { wg.Wait(); close(drained) }()
	select {
	case <-drained:
	case <-time.After(200 * time.Millisecond):
		truncate(0)
		truncate(1)
		outR.Close()
		errR.Close()
		<-drained
	}
	outR.Close()
	errR.Close()
	select {
	case <-overflow:
		return nil, nil, "output-limit"
	default:
	}
	if ctx.Err() != nil {
		return nil, nil, "timeout"
	}
	status := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if status.Signaled() {
		sig := int(status.Signal())
		return nil, &sig, nil
	}
	code := status.ExitStatus()
	if waitErr != nil && code < 0 {
		return nil, nil, "execution-error"
	}
	return &code, nil, nil
}
