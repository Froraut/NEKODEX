//go:build !linux

package main

import (
	"errors"
	"io"
	"os"
)

func listenGuest() (io.ReadWriteCloser, error) { return nil, errors.New("Linux guest only") }
func writeInput(root, p string, data []byte, mode os.FileMode) error {
	return errors.New("Linux guest only")
}
func openOutput(root, p string) (*os.File, error) { return nil, errors.New("Linux guest only") }
func assignWorkspace(root string) error           { return errors.New("Linux guest only") }
func runJob(root, script string, timeout int64, log func(int, []byte), truncate func(int), overflow <-chan struct{}) (*int, *int, any) {
	return nil, nil, "execution-error"
}
