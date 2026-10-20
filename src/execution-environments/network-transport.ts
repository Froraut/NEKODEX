import { request as httpRequest, Agent as HttpAgent } from 'node:http';
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';
import { isIP } from 'node:net';
import { isVmNetworkPublicAddress, type VmNetworkHop, type VmNetworkHopResponse, type VmNetworkTransport } from './network';

/** Direct one-hop transport. It never calls fetch, a global agent, a proxy,
 * DNS, a cookie jar, a host credential helper or an automatic redirect/retry. */
export class DirectVmNetworkTransport implements VmNetworkTransport {
  request(hop: VmNetworkHop): Promise<VmNetworkHopResponse> {
    const family = isIP(hop.address);
    if ((family !== 4 && family !== 6) || !isVmNetworkPublicAddress(hop.address) || !['http:', 'https:'].includes(hop.url.protocol)
      || hop.url.username || hop.url.password || hop.signal.aborted
      || !Number.isSafeInteger(hop.maxResponseBytes) || hop.maxResponseBytes < 1) {
      return Promise.reject(new Error('vm-network-transport-input-denied'));
    }
    const secure = hop.url.protocol === 'https:';
    // A private agent bypasses globally installed proxy agents and connection
    // pools. lookup supplies exactly the approved IP without resolver activity.
    const agent = secure ? new HttpsAgent({ keepAlive: false, maxSockets: 1 }) : new HttpAgent({ keepAlive: false, maxSockets: 1 });
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (error?: Error, value?: VmNetworkHopResponse) => {
        if (settled) return; settled = true; clearTimeout(timer); agent.destroy();
        if (error) reject(error); else resolve(value!);
      };
      const request = (secure ? httpsRequest : httpRequest)({
        protocol: hop.url.protocol, hostname: hop.url.hostname.replace(/^\[|\]$/g, ''), port: hop.url.port || (secure ? '443' : '80'),
        path: hop.url.pathname + hop.url.search, method: hop.method, headers: { ...hop.headers }, agent,
        // Node ignores family autoselection for explicit family 4/6.
        // The custom lookup returns one approved IP without invoking DNS.
        family,
        lookup: (_hostname, _options, callback) => callback(null, hop.address, family),
        maxHeaderSize: 16 * 1024, signal: hop.signal,
        ...(secure ? { servername: isIP(hop.url.hostname.replace(/^\[|\]$/g, '')) ? '' : hop.url.hostname, rejectUnauthorized: true } : {}),
      }, response => {
        const chunks: Buffer[] = []; let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > hop.maxResponseBytes) { response.destroy(); request.destroy(new Error('vm-network-response-limit')); return; }
          chunks.push(Buffer.from(chunk));
        });
        response.once('aborted', () => done(new Error('vm-network-response-aborted')));
        response.once('error', error => done(error));
        response.once('end', () => {
          if (!response.complete) { done(new Error('vm-network-response-incomplete')); return; }
          const location = response.headers.location;
          done(undefined, { statusCode: response.statusCode ?? 0, ...(location !== undefined ? { location } : {}), body: Buffer.concat(chunks, length) });
        });
      });
      const timer = setTimeout(() => request.destroy(new Error('vm-network-timeout')), hop.timeoutMs);
      request.once('upgrade', (_response, socket) => { socket.destroy(); done(new Error('vm-network-upgrade-denied')); });
      request.once('error', error => done(error));
      request.end(hop.body);
    });
  }
}
