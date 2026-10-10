import "reflect-metadata";
import "dotenv/config";
import { ConfigService } from "@nestjs/config";
import configuration from "../config/configuration";
import { createInstanceRepository } from "../modules/storage/storage.module";
import { TelegramClientManager } from "../modules/telegram/telegram-client.manager";
import { InstanceConfigService } from "../modules/user/instance-config.service";

interface Options {
  overwrite: boolean;
  dryRun: boolean;
}

/** Fetch names sequentially and release each managed connection after use. */
export async function updateTelegramNames(
  config: Pick<InstanceConfigService, "getUsers" | "getUserByToken" | "updateUserName">,
  clients: Pick<TelegramClientManager, "getOrInitializeClient" | "removeClient">,
  options: Options,
  report: (message: string) => void = console.log,
) {
  const counts = { updated: 0, skipped: 0, failed: 0 };
  const accounts = Object.values(config.getUsers());
  for (const [index, account] of accounts.entries()) {
    const label = `Account ${index + 1}/${accounts.length}`;
    if (account.blocked || !account.sessionString || (!options.overwrite && account.name?.trim())) {
      counts.skipped++;
      continue;
    }
    try {
      const client = await clients.getOrInitializeClient(account.token, account.sessionString);
      const me = await client.getMe();
      if (!me || !("phone" in me) ||
          (account.telegramId
            ? account.telegramId !== me.id.toString()
            : account.phone.replace(/\D/g, "") !== me.phone?.replace(/\D/g, ""))) {
        throw new Error("Account identity mismatch");
      }
      const name = ([me.firstName, me.lastName].filter(Boolean).join(" ").trim() || me.username || "").slice(0, 80);
      // Recheck the account after Telegram I/O before writing its name.
      const current = config.getUserByToken(account.token);
      if (!name || !current || current.blocked || current.sessionString !== account.sessionString ||
          current.telegramId !== account.telegramId || current.phone !== account.phone ||
          current.name !== account.name || current.name === name) {
        counts.skipped++;
        report(`${label}: skipped (unchanged, unavailable, or modified during lookup).`);
        continue;
      }
      if (!options.dryRun) config.updateUserName(account.token, name);
      counts.updated++;
      report(`${label}: ${options.dryRun ? "would update" : "updated"} name to ${JSON.stringify(name)}.`);
    } catch {
      counts.failed++;
      // Do not print Telegram errors, sessions, phones, or private account tokens.
      report(`${label}: failed to fetch or save its Telegram name.`);
    } finally {
      await clients.removeClient(account.token);
    }
  }
  report(`${options.dryRun ? "Preview" : "Done"}: ${counts.updated} ${options.dryRun ? "would update" : "updated"}, ${counts.skipped} skipped, ${counts.failed} failed.`);
  return counts;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: pnpm run update:telegram-names [--dry-run] [--overwrite]\nFills empty names from Telegram. --overwrite also replaces existing names.\nUses .env, STORAGE_DRIVER and DATA_DIR. Stop StreamGram before running.");
    return;
  }
  if (args.some(arg => !["--dry-run", "--overwrite"].includes(arg))) {
    throw new Error("Unknown option. Run with --help for usage.");
  }
  const configService = new ConfigService(configuration());
  const repository = createInstanceRepository(configService);
  let clients: TelegramClientManager | undefined;
  try {
    const config = new InstanceConfigService(configService, repository);
    clients = new TelegramClientManager(configService, config);
    const counts = await updateTelegramNames(config, clients, {
      overwrite: args.includes("--overwrite"), dryRun: args.includes("--dry-run"),
    });
    if (counts.failed) process.exitCode = 1;
  } finally {
    try {
      await clients?.onApplicationShutdown();
    } finally {
      repository.close();
    }
  }
}

if (require.main === module) {
  void main().catch(() => {
    console.error("Name update failed. Check options, storage configuration, and Telegram credentials.");
    process.exitCode = 1;
  });
}
