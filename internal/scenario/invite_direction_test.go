package scenario

import "testing"

func TestInviteDirectionDeterminesMode(t *testing.T) {
	for _, tc := range []struct {
		name, xml string
		mode      Mode
	}{
		{"outgoing receives bye", `<send><![CDATA[INVITE sip:test@localhost SIP/2.0
Content-Length: 0

]]></send><recv request="BYE"/>`, ModeClient},
		{"incoming sends bye", `<recv request="INVITE"/><send><![CDATA[BYE sip:test@localhost SIP/2.0
Content-Length: 0

]]></send>`, ModeServer},
		{"outgoing after options", `<recv request="OPTIONS"/><send><![CDATA[INVITE sip:test@localhost SIP/2.0
Content-Length: 0

]]></send><recv request="BYE"/>`, ModeClient},
		{"options server", `<recv request="OPTIONS"/>`, ModeServer},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sc, err := ParseString(`<scenario name="test">` + tc.xml + `</scenario>`)
			if err != nil {
				t.Fatal(err)
			}
			if sc.Mode != tc.mode {
				t.Fatalf("mode=%s want=%s", sc.Mode, tc.mode)
			}
		})
	}
}
