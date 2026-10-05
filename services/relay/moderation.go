package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"fiatjaf.com/nostr"
)

// Read the operator's atomically replaced policy. Unreadable configured policy
// denies content; an empty environment value is the explicit unmoderated profile.
type moderationPolicy struct {
	sync.Mutex
	path     string
	modified time.Time
	size     int64
	keys     map[string]bool
}

var moderationHex = regexp.MustCompile(`^[a-f0-9]{64}$`)
var moderationAddress = regexp.MustCompile(`^(35129:[a-f0-9]{64}:[^\x00-\x1f\x7f]{0,256}|15129:[a-f0-9]{64}:)$`)

func (p *moderationPolicy) load() error {
	if p.path == "" {
		return nil
	}
	info, err := os.Stat(p.path)
	if err != nil || info.Size() > 8*1024*1024 {
		return fmt.Errorf("moderation policy unavailable")
	}
	if p.keys != nil && p.modified.Equal(info.ModTime()) && p.size == info.Size() {
		return nil
	}
	data, err := os.ReadFile(p.path)
	if err != nil {
		return fmt.Errorf("moderation policy unavailable")
	}
	var document struct {
		Version int `json:"version"`
		Rules   []struct {
			Type   string `json:"type"`
			Target string `json:"target"`
		} `json:"rules"`
	}
	if json.Unmarshal(data, &document) != nil || document.Version != 1 || document.Rules == nil || len(document.Rules) > 10000 {
		return fmt.Errorf("invalid moderation policy")
	}
	keys := map[string]bool{}
	for _, rule := range document.Rules {
		valid := (rule.Type == "address" && moderationAddress.MatchString(rule.Target)) || ((rule.Type == "pubkey" || rule.Type == "event" || rule.Type == "hash") && moderationHex.MatchString(rule.Target))
		key := rule.Type + ":" + rule.Target
		if !valid || keys[key] {
			return fmt.Errorf("invalid moderation rule")
		}
		keys[key] = true
	}
	p.keys, p.modified, p.size = keys, info.ModTime(), info.Size()
	return nil
}
func (p *moderationPolicy) check() error {
	p.Lock()
	defer p.Unlock()
	return p.load()
}

// Only legacy path/aggregate snapshots use a as an own-address association.
// A raw x always selects standalone semantics, including on malformed hybrids.
func legacySnapshotAddress(e nostr.Event) string {
	if e.Kind != 5129 {
		return ""
	}
	legacy, addresses, address := false, 0, ""
	for _, tag := range e.Tags {
		if len(tag) == 0 {
			continue
		}
		if tag[0] == "x" && len(tag) == 2 {
			return ""
		}
		if tag[0] == "path" || (tag[0] == "x" && len(tag) >= 3 && tag[2] == "aggregate") {
			legacy = true
		}
		if tag[0] == "a" {
			addresses++
			if len(tag) >= 2 {
				address = tag[1]
			}
		}
	}
	if legacy && addresses == 1 && moderationAddress.MatchString(address) && strings.Split(address, ":")[1] == e.PubKey.Hex() {
		return address
	}
	return ""
}

func (p *moderationPolicy) blocked(e nostr.Event) bool {
	p.Lock()
	defer p.Unlock()
	if p.load() != nil {
		return true
	}
	// Preserve signed author deletions, including for blocked authors.
	if e.Kind == 5 {
		return false
	}
	if p.keys["pubkey:"+e.PubKey.Hex()] || p.keys["event:"+e.ID.Hex()] {
		return true
	}
	prefix := "35129:" + e.PubKey.Hex() + ":"
	if e.Kind == 15129 && p.keys["address:15129:"+e.PubKey.Hex()+":"] {
		return true
	}
	if e.Kind == 35129 && p.keys["address:"+prefix+e.Tags.GetD()] {
		return true
	}
	if address := legacySnapshotAddress(e); address != "" && p.keys["address:"+address] {
		return true
	}
	for _, tag := range e.Tags {
		if len(tag) >= 2 {
			if tag[0] == "x" && p.keys["hash:"+tag[1]] {
				return true
			}
		}
		if len(tag) >= 3 && tag[0] == "path" && p.keys["hash:"+tag[2]] {
			return true
		}
	}
	return false
}
