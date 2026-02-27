//go:build windows

package discovery

import "testing"

func TestExpandWindowsEnvVarsReplacesKnownVariables(t *testing.T) {
	t.Setenv("HSM_DOCS_TEST", `C:\Users\Example\OneDrive`)

	resolved := expandWindowsEnvVars(`%HSM_DOCS_TEST%\Documents`)
	if resolved != `C:\Users\Example\OneDrive\Documents` {
		t.Fatalf("unexpected expanded path: got %q", resolved)
	}
}

func TestExpandWindowsEnvVarsKeepsUnknownVariables(t *testing.T) {
	resolved := expandWindowsEnvVars(`%DOES_NOT_EXIST%\Documents`)
	if resolved != `%DOES_NOT_EXIST%\Documents` {
		t.Fatalf("unexpected path for unknown variable: got %q", resolved)
	}
}
