import { HttpException } from "@nestjs/common";
import { Request } from "express";
import { InstanceConfigService } from "../user/instance-config.service";
import { ManagementService } from "./management.service";

describe("Admin password cooldown", () => {
  const windowMs = 15 * 60 * 1000;
  let now: number;
  let service: ManagementService;
  let verify: jest.Mock;
  const request = (ip = "192.0.2.1", password?: string) => ({
    ip,
    headers: {},
    socket: { remoteAddress: ip },
    get: (header: string) => header === "x-admin-password" ? password : undefined,
    res: { setHeader: jest.fn() },
  }) as unknown as Request;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    verify = jest.fn((password: string) => password === "12345678");
    service = new ManagementService({
      verifyAdminPassword: verify,
      isManagementInitialized: () => true,
      isProtected: () => true,
    } as unknown as InstanceConfigService);
  });
  afterEach(() => jest.restoreAllMocks());

  it("shares failures across entry points and blocks verification until cooldown expires", () => {
    const login = request();
    const header = request("192.0.2.1", "wrong");
    for (let i = 0; i < 2; i++) {
      expect(service.verifyAdminPassword(login, "wrong")).toBe(false);
      expect(service.isAuthenticated(header)).toBe(false);
    }
    now += 60_000;
    expect(() => service.isAuthenticated(header)).toThrow(HttpException);
    expect(header.res?.setHeader).toHaveBeenCalledWith("Retry-After", "900");
    expect(verify).toHaveBeenCalledTimes(5);
    now += windowMs - 1;
    expect(() => service.verifyAdminPassword(login, "12345678")).toThrow(HttpException);
    expect(() => service.isAuthenticated(request("192.0.2.1", "12345678"))).toThrow(HttpException);
    expect(verify).toHaveBeenCalledTimes(5);
    expect(login.res?.setHeader).toHaveBeenCalledWith("Retry-After", "1");
    expect(service.verifyAdminPassword(request("192.0.2.2"), "12345678")).toBe(true);
    now += 1;
    expect(service.verifyAdminPassword(login, "12345678")).toBe(true);
  });

  it("resets failures on success and ignores missing credentials", () => {
    const req = request();
    for (let i = 0; i < 4; i++) expect(service.verifyAdminPassword(req, "wrong")).toBe(false);
    for (let i = 0; i < 6; i++) expect(service.isAuthenticated(req)).toBe(false);
    expect(verify).toHaveBeenCalledTimes(4);
    expect(service.isAuthenticated(request("192.0.2.1", "12345678"))).toBe(true);
    for (let i = 0; i < 4; i++) expect(service.verifyAdminPassword(req, "wrong")).toBe(false);
  });

  it("expires incomplete failure windows", () => {
    const req = request();
    for (let i = 0; i < 4; i++) service.verifyAdminPassword(req, "wrong");
    now += windowMs;
    expect(service.verifyAdminPassword(req, "wrong")).toBe(false);
  });
});
