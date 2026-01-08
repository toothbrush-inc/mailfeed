/**
 * Centralized logging utilities for consistent log formatting
 */

type LogLevel = "info" | "warn" | "error" | "debug"

interface LogContext {
  [key: string]: unknown
}

/**
 * Format a log message with optional context data
 */
function formatMessage(
  prefix: string,
  message: string,
  context?: LogContext
): string {
  const contextStr = context
    ? " " + JSON.stringify(context)
    : ""
  return `[${prefix}] ${message}${contextStr}`
}

/**
 * Create a logger for a specific module/component
 */
function createLogger(prefix: string) {
  return {
    info: (message: string, context?: LogContext) => {
      console.log(formatMessage(prefix, message, context))
    },
    warn: (message: string, context?: LogContext) => {
      console.warn(formatMessage(prefix, message, context))
    },
    error: (message: string, error?: Error | unknown, context?: LogContext) => {
      const errorContext = error instanceof Error
        ? { ...context, error: error.message }
        : context
      console.error(formatMessage(prefix, message, errorContext))
    },
    debug: (message: string, context?: LogContext) => {
      if (process.env.NODE_ENV === "development") {
        console.log(formatMessage(prefix, message, context))
      }
    },
    /**
     * Log with timing information
     */
    timed: (message: string, startTime: number, context?: LogContext) => {
      const elapsed = Date.now() - startTime
      console.log(formatMessage(prefix, `${message} in ${elapsed}ms`, context))
    },
  }
}

// Pre-configured loggers for common modules
export const syncLogger = createLogger("Sync")
export const linkLogger = createLogger("Link")
export const gmailLogger = createLogger("Gmail")
export const contentLogger = createLogger("Content")
export const aiLogger = createLogger("AI")
export const nestedLinkLogger = createLogger("Nested Links")
export const apiLogger = createLogger("API")

// Export the factory for custom loggers
export { createLogger }
