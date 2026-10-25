// The single data seam for screens. Every call is answered by the in-memory stub (./stub), nothing
// goes to the network; STUBS.md lists the stubs. The real clients stay in ./real and ./streamsSocket:
// to use the backend again, import from them here instead. Tests replace members of `api` with
// vi.mock("../api").
import * as stub from "./stub";

export * from "./types";
export { deleteSession, exportUrl, fetchHealth, fetchSessions } from "./stub";

export const api = {
  listStreams: stub.listStreams,
  createStream: stub.createStream,
  updateStream: stub.updateStream,
  deleteStream: stub.deleteStream,
  reconnectStream: stub.reconnectStream,
  testStream: stub.testStream,
  connectStreams: stub.connectStreams,
  fetchSystem: stub.fetchSystem,
  fetchStreamLog: stub.fetchStreamLog,
  listEvents: stub.listEvents,
  ackEvent: stub.ackEvent,
  exportEvents: stub.exportEvents,
  fetchSettings: stub.fetchSettings,
  saveSettings: stub.saveSettings,
  listFileSessions: stub.listFileSessions,
  fetchFileSession: stub.fetchFileSession,
  uploadFile: stub.uploadFile,
  fetchTimeline: stub.fetchTimeline,
  fileMediaUrl: stub.mediaUrl,
  fileExportUrl: stub.exportUrl,
};
