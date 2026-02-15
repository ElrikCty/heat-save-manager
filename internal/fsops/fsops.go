package fsops

import "errors"

var ErrNotImplemented = errors.New("not implemented")

type Operations interface {
	CopyDir(source string, destination string) error
	ReplaceDir(source string, destination string) error
	RemoveDir(path string) error
}

type Local struct{}

func NewLocal() *Local {
	return &Local{}
}

func (l *Local) CopyDir(source string, destination string) error {
	return ErrNotImplemented
}

func (l *Local) ReplaceDir(source string, destination string) error {
	return ErrNotImplemented
}

func (l *Local) RemoveDir(path string) error {
	return ErrNotImplemented
}
