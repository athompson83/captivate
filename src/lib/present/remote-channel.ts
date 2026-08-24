"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { PresentMessage } from "./protocol";
import {
  RemoteInbox,
  newClientId,
  remoteTopic,
  seal,
  type RemoteEnvelope,
  type RemoteStatus,
} from "./remote";

/**
 * The phone remote's transport.
 *
 * A private Realtime channel, which means Supabase checks a policy on every
 * join and every publish rather than admitting anyone who knows the topic
 * name. That policy — `captivate_remote_topic_open` — is the authorisation;
 * this class is only the plumbing around it, and it does not get to decide
 * anything about who may connect.
 *
 * Every inbound message still goes through `RemoteInbox`, because a transport
 * that is supposed to carry only this session's traffic is exactly the kind of
 * assumption worth not relying on.
 */

const EVENT = "captivate";

export interface RemoteChannelOptions {
  sessionId: string;
  onMessage: (message: PresentMessage) => void;
  onStatus?: (status: RemoteStatus) => void;
}

export class RemoteChannel {
  private channel: RealtimeChannel | null = null;
  private readonly clientId = newClientId();
  private readonly inbox: RemoteInbox;
  private closed = false;

  constructor(private readonly options: RemoteChannelOptions) {
    this.inbox = new RemoteInbox(options.sessionId, this.clientId);
    this.open();
  }

  private set status(status: RemoteStatus) {
    this.options.onStatus?.(status);
  }

  private open(): void {
    if (this.closed || this.channel) return;
    try {
      const supabase = supabaseBrowser();
      const channel = supabase.channel(remoteTopic(this.options.sessionId), {
        // Without this the topic is open to anyone who learns its name; with
        // it, every join and publish goes through the policy on
        // realtime.messages. It is the whole security model of this feature.
        config: { private: true, broadcast: { self: false } },
      });

      channel.on("broadcast", { event: EVENT }, (payload) => {
        const verdict = this.inbox.accept((payload as { payload?: unknown }).payload);
        if (verdict.ok) this.options.onMessage(verdict.envelope.payload);
      });

      channel.subscribe((state) => {
        if (this.closed) return;
        if (state === "SUBSCRIBED") this.status = "connected";
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") this.status = "reconnecting";
        else if (state === "CLOSED") this.status = "disconnected";
      });

      this.channel = channel;
    } catch {
      this.channel = null;
      this.status = "disconnected";
    }
  }

  /** Sends a message. Resolves false when it could not be handed to the service. */
  async send(message: PresentMessage): Promise<boolean> {
    if (!this.channel || this.closed) return false;
    const envelope: RemoteEnvelope = seal(this.options.sessionId, this.clientId, message);
    try {
      const result = await this.channel.send({
        type: "broadcast",
        event: EVENT,
        payload: envelope,
      });
      // "ok" means the service took it, which is not the same as the stage
      // acting on it. The caller waits for a `state` echo for that.
      return result === "ok";
    } catch {
      return false;
    }
  }

  close(): void {
    this.closed = true;
    const channel = this.channel;
    this.channel = null;
    this.status = "disconnected";
    if (!channel) return;
    try {
      void supabaseBrowser().removeChannel(channel);
    } catch {
      // Already gone.
    }
  }
}
