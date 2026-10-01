/** Use explicit Drizzle statement boundaries, never split SQL strings/comments on semicolons. */
export function migrationStatements(migration: string): string[] {
  return migration.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean);
}