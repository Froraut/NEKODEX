# Actual host-mediated HTTPS request and durable broker receipt

The real `VmNetworkBroker`, `DirectVmNetworkTransport` and `FileVmNetworkLedger` completed one credential-free HTTPS GET on 19 October 2026. This establishes the positive live transport and durable broker boundary. The owner adapter supplied a synthetic exact QA scope; no actual VM existed. It is not acceptance of the whole product ToolJournal, GUI grant flow, guest networking or installed runtime.

The retained receipt is `/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/network-real/acceptance.json`, accepted at 11:59:58 UTC and finished at 11:59:59 UTC. This report reads that result; it does not repeat the external request.

| Boundary | Observed result |
| --- | --- |
| Exact scope | task `a2c8d2e7-a5ac-48d9-a481-703b29ce3994`, generation1, action `6f7c4dda-9c91-4a90-ab5c-d6412f60649c` |
| Request | `GET https://example.com/`; body0; credential owner `none`; proxy `none` |
| Address admission | DNS resolved outside the broker before review; reviewed public IPv4 pins `8.47.69.7`, `8.6.112.7`; actual direct transport address `8.47.69.7`; broker policy `pinned-no-lookup` |
| Grant limits | one request;4096 request bytes;16384 response bytes; zero redirects;15000ms timeout |
| Live response | HTTP200;577 bytes; SHA-256 `25ddf2c883e0d1958ea971d279a7e4f0fd446724ee3db7db19dadabd4a62e484` |
| Saved receipt | completed, `vm-network-http-response-captured`; requests1, requestBytes94, responseBytes577; same response status/hash |
| Duplicate same request ID | exact same saved receipt; response absent; total transportCalls remained1 |
| Fresh ledger read | a fresh `FileVmNetworkLedger` read back the same durable receipt |
| Cleanup | grant revoked; broker closed; stop callbacks addressed only the synthetic exact scope |
| Other execution | zero VM boots, model offers and GUI launches; no VM owner or guest process existed |

The duplicate result is retained evidence of no second transport effect in this case, not a guarantee that arbitrary external effects are exactly once. The grant and ledger retain their existing authority and unknown-outcome rules. Revocation/close callbacks do not prove physical VM termination because this acceptance had no VM.

TLS succeeded on this positive request. Certificate rejection, failed TLS, redirects, live cancellation/uncertain remote effects and other negative network cases were not exercised by this observation. Existing inert cases remain separate contract evidence; they cannot be relabelled as new live negative tests.

The guest remains without a NIC or arbitrary subprocess sockets. The DNS lookup before review does not give the broker DNS authority. This result does not prove the actual product's ToolJournal approval, GUI/user grant, task binding, guest request route, installed transport, signed production launch or configured OAuth networking. The API-level host transport/broker/ledger proof is the accepted scope.

The committed baseline remains `b26b0c9da40fccc590f871ef46e7966789c429a1`; its existing exact-head CI success applies only to that committed revision. The current coherent follow-up batch is unfinished; no CI success for its uncommitted work, new package or installed acceptance is claimed here. The earlier offline PEP517 controller/attachment/second-VM import acceptance remains unchanged.
