import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ManagementService } from "./management.service";
import {
  AdminGuard,
  PersonalGuard,
  ManagementOriginGuard,
} from "./management.guards";
import {
  InvitationController,
  ManagementController,
} from "./management.controller";
import { AuthModule } from "../auth/auth.module";

@Global()
@Module({
  imports: [AuthModule],
  controllers: [ManagementController, InvitationController],
  providers: [
    ManagementService,
    AdminGuard,
    PersonalGuard,
    { provide: APP_GUARD, useClass: ManagementOriginGuard },
  ],
  exports: [ManagementService, AdminGuard, PersonalGuard],
})
export class ManagementModule {}
