package engine

import (
	"context"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/sipcapture/gossipper/internal/scenario"
	"github.com/sipcapture/gossipper/internal/sip"
)

// A server request is routed by Call-ID, even when its source port differs
// from the configured peer and its CSeq is unrelated to the client ACK.
func TestUDPServerBYEFromDifferentSourcePort(t *testing.T) {
	t.Setenv("GOSSIPPER_UDP_RECEIVERS", "4")
	peer, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	peerAddr := peer.LocalAddr().(*net.UDPAddr)
	peerResult := make(chan error, 1)
	go func() {
		peerResult <- func() error {
			buf := make([]byte, 65535)
			_ = peer.SetReadDeadline(time.Now().Add(3 * time.Second))
			n, client, err := peer.ReadFromUDP(buf)
			if err != nil {
				return err
			}
			invite, err := sip.Parse(buf[:n])
			if err != nil {
				return err
			}
			id, _ := sip.Header(invite.Headers, "Call-ID")
			from, _ := sip.Header(invite.Headers, "From")
			to, _ := sip.Header(invite.Headers, "To")
			// Send 200 from a different source port, then use that source
			// for BYE. The configured peer port receives the 200 OK response.
			_ = peer.Close()
			other, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
			if err != nil {
				return err
			}
			defer other.Close()
			if _, err = other.WriteToUDP(sip.BuildResponse(invite, 200, "OK"), client); err != nil {
				return err
			}
			time.Sleep(200 * time.Millisecond)
			listener, err := net.ListenUDP("udp", peerAddr)
			if err != nil {
				return err
			}
			defer listener.Close()
			bye := fmt.Sprintf("BYE sip:gossip@%s SIP/2.0\r\nVia: SIP/2.0/UDP %s;rport;branch=z9hG4bKpeer-bye\r\nFrom: %s\r\nTo: %s\r\nCall-ID: %s\r\nCSeq: 121428717 BYE\r\nContent-Length: 0\r\n\r\n", client, peerAddr, to, from, id)
			// A different source port also proves demux uses Call-ID rather
			// than requiring the configured peer's source address.
			if _, err = other.WriteToUDP([]byte(bye), client); err != nil {
				return err
			}
			_ = listener.SetReadDeadline(time.Now().Add(2 * time.Second))
			n, _, err = listener.ReadFromUDP(buf)
			if err != nil {
				return fmt.Errorf("no 200 OK for peer BYE: %w", err)
			}
			response, err := sip.Parse(buf[:n])
			if err != nil {
				return err
			}
			responseID, _ := sip.Header(response.Headers, "Call-ID")
			seq, method, _ := sip.ParseCSeq(response.Headers)
			if response.StatusCode != 200 || responseID != id || seq != 121428717 || method != "BYE" {
				return fmt.Errorf("incorrect BYE response: %s", response.Raw)
			}
			return nil
		}()
	}()

	sc, err := scenario.ParseString(`<scenario name="peer_bye">
<send><![CDATA[INVITE sip:test@[remote_ip]:[remote_port] SIP/2.0
Via: SIP/2.0/UDP [local_ip]:[local_port];branch=[branch];rport
From: <sip:loadtest@[local_ip]>;tag=client
To: <sip:test@[remote_ip]>
Call-ID: [call_id]
CSeq: 1 INVITE
Content-Length: 0

]]></send>
<recv response="200" timeout="1000"/>
<send><![CDATA[ACK sip:test@[remote_ip]:[remote_port] SIP/2.0
Via: SIP/2.0/UDP [local_ip]:[local_port];branch=[branch];rport
From: <sip:loadtest@[local_ip]>;tag=client
To: <sip:test@[remote_ip]>
Call-ID: [call_id]
CSeq: 1 ACK
Content-Length: 0

]]></send>
<recv request="BYE" timeout="1500"/>
<send><![CDATA[SIP/2.0 200 OK
[last_Via:]
[last_From:]
[last_To:]
[last_Call-ID:]
[last_CSeq:]
Content-Length: 0

]]></send></scenario>`)
	if err != nil {
		t.Fatal(err)
	}
	app := New(Config{Scenario: sc, Transport: "u1", LocalIP: "127.0.0.1", RemoteHost: "127.0.0.1", RemotePort: peerAddr.Port, Rate: 100, TotalCalls: 1, MaxConcurrent: 1, DefaultRecvTO: time.Second})
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	runErr := app.Run(ctx)
	if err := <-peerResult; err != nil {
		t.Error(err)
	}
	if runErr != nil {
		t.Fatal(runErr)
	}
	if snapshot := app.Stats().Snapshot(); snapshot.SuccessCalls != 1 || snapshot.FailedCalls != 0 {
		t.Fatalf("unexpected stats: %+v", snapshot)
	}
}
