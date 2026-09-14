export const FEATURE_FLAGS = {
    // Global flag to enable/disable analysis features entirely.
    // NEXT_PUBLIC_: the browser bundle bakes the value in at build time,
    // while the server and the worker read it at runtime — set it in both
    // places (the Dockerfile does, from one ARG) or the UI and the API
    // disagree.
    enableAnalysis: process.env.NEXT_PUBLIC_ENABLE_ANALYSIS === "true",
}
