import { EventEmitter } from "node:events";
import type { MessageEvent } from "@nestjs/common";
import Redis from "ioredis";
import { SignJWT, jwtVerify } from "jose";
import { Observable } from "rxjs";
import { env } from "../config/env";
import { ctx } from "../common/context";
import { unauthenticated } from "../common/errors";
import { redis } from "../common/redis";
import { afterCommit } from "../common/tx";

export type LiveEvent = { kind: "project" | "lead" | "vendor" | "org"; id?: string; projectId?: string };
type Scope = "all" | string[];

/** Tells open screens something changed. Ids only; screens refetch through the normal, permission-checked API. */
export function changed(e: LiveEvent) {
  const orgId = String(ctx().orgId);
  afterCommit(() => redis.publish(`live:${orgId}`, JSON.stringify(e)));
}

export function visible(e: LiveEvent, scope: Scope) {
  if (scope === "all") return true;
  return !!e.projectId && scope.includes(e.projectId);
}

const secret = new TextEncoder().encode(env.LIVE_TICKET_SECRET);

export function issueTicket() {
  const c = ctx();
  return new SignJWT({ org: String(c.orgId), scope: c.projectScope === "all" ? "all" : c.projectScope.map(String) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(c.userId))
    .setExpirationTime("60s")
    .sign(secret);
}

export async function readTicket(ticket: string): Promise<{ orgId: string; scope: Scope }> {
  try {
    const { payload } = await jwtVerify(ticket, secret, { algorithms: ["HS256"] });
    return { orgId: String(payload.org), scope: payload.scope as Scope };
  } catch {
    throw unauthenticated("UNAUTHENTICATED", "The live updates link expired");
  }
}

// One Redis subscriber per instance, fanned out in memory to each open stream.
const emitter = new EventEmitter().setMaxListeners(0);
const refs = new Map<string, number>();
let sub: Redis | undefined;

function subscriber() {
  if (!sub) {
    sub = new Redis(env.REDIS_URL);
    sub.on("message", (channel, message) => emitter.emit(channel, message));
  }
  return sub;
}

export function liveStream(orgId: string, scope: Scope): Observable<MessageEvent> {
  return new Observable<MessageEvent>((out) => {
    const channel = `live:${orgId}`;
    if ((refs.get(channel) ?? 0) === 0) void subscriber().subscribe(channel);
    refs.set(channel, (refs.get(channel) ?? 0) + 1);

    const onMessage = (raw: string) => {
      const e = JSON.parse(raw) as LiveEvent;
      if (visible(e, scope)) out.next({ data: e });
    };
    emitter.on(channel, onMessage);
    const ping = setInterval(() => out.next({ type: "ping", data: "" }), 25_000);

    return () => {
      clearInterval(ping);
      emitter.off(channel, onMessage);
      const left = (refs.get(channel) ?? 1) - 1;
      refs.set(channel, left);
      if (left === 0) void subscriber().unsubscribe(channel);
    };
  });
}
