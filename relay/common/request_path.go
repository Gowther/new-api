package common

import "strings"

// NormalizeRequestPath maps internal playground routes to the public relay paths
// used by channel capability checks and upstream adaptors.
func NormalizeRequestPath(requestPath string) string {
	if requestPath == "/pg" {
		return "/v1"
	}
	if strings.HasPrefix(requestPath, "/pg/") {
		return "/v1/" + strings.TrimPrefix(requestPath, "/pg/")
	}
	return requestPath
}
