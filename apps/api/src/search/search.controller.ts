import { Controller, Get } from "@nestjs/common";
import { searchQuery } from "@veenix/shared";
import { Can } from "../common/decorators";
import { ZQuery } from "../common/zod";
import { search } from "./search";

@Controller("search")
export class SearchController {
  @Can() @Get()
  find(@ZQuery(searchQuery) query: { q: string }) {
    return search(query.q);
  }
}
