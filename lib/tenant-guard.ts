import { Prisma } from "@prisma/client"

const LIST_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
])

const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"])

function whereHasUserId(where: unknown): boolean {
  if (!where || typeof where !== "object") return false
  const w = where as Record<string, unknown>
  if (typeof w.userId === "string" && w.userId.length > 0) return true
  if (w.userId && typeof w.userId === "object") return true
  if (w.userId_gmailId && typeof w.userId_gmailId === "object") {
    const compound = w.userId_gmailId as Record<string, unknown>
    if (typeof compound.userId === "string") return true
  }
  if (Array.isArray(w.AND)) return w.AND.some(whereHasUserId)
  return false
}

function createHasUserId(data: unknown): boolean {
  if (!data) return false
  const rows = Array.isArray(data) ? data : [data]
  return rows.every(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof (row as Record<string, unknown>).userId === "string" &&
      ((row as Record<string, unknown>).userId as string).length > 0
  )
}

/**
 * Fail-closed tenant isolation for Email: list/search/create must name a
 * userId so one mailbox cannot be scanned as another. findUnique by primary
 * key is still allowed for nested includes; API handlers that take an email
 * id from the client should use findFirst({ id, userId }) instead.
 */
export function tenantIsolationExtension() {
  return Prisma.defineExtension({
    name: "tenant-isolation",
    query: {
      email: {
        async $allOperations({ operation, args, query }) {
          const record = args as Record<string, unknown>
          if (LIST_OPS.has(operation) && !whereHasUserId(record.where)) {
            throw new Error(
              `Email.${operation} requires where.userId so mailboxes stay per-user`
            )
          }
          if (CREATE_OPS.has(operation) && !createHasUserId(record.data)) {
            throw new Error(`Email.${operation} requires data.userId`)
          }
          if (operation === "upsert") {
            if (!whereHasUserId(record.where) || !createHasUserId(record.create)) {
              throw new Error("Email.upsert requires userId on where and create")
            }
          }
          return query(args)
        },
      },
    },
  })
}
