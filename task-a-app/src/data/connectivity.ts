import NetInfo from '@react-native-community/netinfo';
import type { ConnectivityMonitor } from '../core/ports';
import type { ConnectionState } from '../core/types';

/**
 * NetInfo reports both "connected" and "internet reachable". They are not the
 * same thing, and the difference is the entire captive-portal problem: a van
 * parked outside a hotel is connected to wifi it has not logged into, so
 * requests resolve to a login page rather than the API. Treating that as online
 * would mean every queued change fails against HTML it cannot parse.
 *
 * When reachability is unknown (NetInfo returns null before its first probe),
 * we assume online and let the request itself decide. A failed attempt is
 * cheaper than a driver stuck in a false offline state.
 */
export interface NetInfoConnectivityOptions {
  /**
   * What "reachable" is measured against. NetInfo defaults to a Google 204
   * endpoint, which is the wrong question and, from a browser, an unanswerable
   * one: the probe is blocked by CORS, reachability resolves to false, and the
   * app decides it is offline while sitting on a working connection. Pointing
   * it at our own API asks the only question that matters — can this device
   * reach dispatch — and is what makes the captive-portal case above detectable
   * rather than theoretical.
   */
  reachabilityUrl?: string;
}

export class NetInfoConnectivity implements ConnectivityMonitor {
  private state: ConnectionState = 'online';
  private listeners = new Set<(state: ConnectionState) => void>();

  constructor(options: NetInfoConnectivityOptions = {}) {
    if (options.reachabilityUrl) {
      NetInfo.configure({
        reachabilityUrl: options.reachabilityUrl,
        // Any answer from our own server proves the path is open. A 5xx means
        // dispatch is unwell, not that the van has no signal, and those are
        // different problems with different remedies.
        reachabilityTest: async (response) => response.status < 500,
        reachabilityLongTimeout: 60_000,
        reachabilityShortTimeout: 5_000,
        reachabilityRequestTimeout: 10_000,
      });
    }

    NetInfo.addEventListener((info) => {
      const reachable = info.isInternetReachable ?? info.isConnected ?? true;
      const next: ConnectionState = info.isConnected && reachable ? 'online' : 'offline';
      if (next !== this.state) {
        this.state = next;
        for (const listener of this.listeners) listener(next);
      }
    });
  }

  getState(): ConnectionState {
    return this.state;
  }

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
