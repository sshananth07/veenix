import { Controller, Post, Query, Sse, type MessageEvent } from "@nestjs/common";
import { from, switchMap, type Observable } from "rxjs";
import { Can, Public } from "../common/decorators";
import { issueTicket, liveStream, readTicket } from "./live";

@Controller("live")
export class LiveController {
  @Can() @Post("ticket")
  async ticket() {
    return { ticket: await issueTicket() };
  }

  // EventSource can't send headers, so the stream authenticates with the short-lived ticket.
  // The stream ends when the function hits its time limit; the browser reconnects with a new ticket.
  @Public() @Sse()
  stream(@Query("ticket") ticket = ""): Observable<MessageEvent> {
    return from(readTicket(ticket)).pipe(switchMap((t) => liveStream(t.orgId, t.scope, t.userId)));
  }
}
