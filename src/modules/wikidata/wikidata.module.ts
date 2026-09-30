import { Module } from "@nestjs/common";
import { WikidataService } from "./wikidata.service";

@Module({
  providers: [WikidataService],
  exports: [WikidataService],
})
export class WikidataModule {}
