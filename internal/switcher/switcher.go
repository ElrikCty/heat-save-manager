package switcher

import (
	"errors"
	"time"
)

var ErrNotImplemented = errors.New("switch profile not implemented")

type Params struct {
	ProfileName string
}

type Result struct {
	ProfileName string
	SwitchedAt  time.Time
	RolledBack  bool
}

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) Switch(params Params) (Result, error) {
	_ = params
	return Result{}, ErrNotImplemented
}
