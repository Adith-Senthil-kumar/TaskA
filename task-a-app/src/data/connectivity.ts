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
export class NetInfoConnectivity implements ConnectivityMonitor {
  private state: ConnectionState = 'online';
  private listeners = new Set<(state: ConnectionState) => void>();

  constructor() {
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
