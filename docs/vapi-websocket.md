# Vapi WebSocket Call Flow

This guide explains how to bridge a live phone call with Vapi's AI assistant using the WebSocket transport returned from the `POST /call` API.

## 1. Request a WebSocket Call
1. Handle the inbound or outbound call with your telephony provider (for example, Twilio).
2. From your backend, create a call in Vapi:
   - Send `POST /call` with the assistant identifier.
   - Provide a `transport.websocket` configuration (include audio settings or metadata as needed).
3. Vapi responds with a `websocketCallUrl`. This URL is the entry point for the bi-directional audio and event stream.

## 2. Connect to the WebSocket
1. Open a WebSocket connection from your backend or service to the `websocketCallUrl`.
2. Authenticate the connection using your Vapi API key.
3. Treat this WebSocket as your live media pipe to Vapi; it does not perform any telephony actions by itself.

## 3. Bridge Audio Between Systems
1. Receive audio chunks from your telephony provider (e.g., Twilio Media Streams) over their WebSocket.
2. Forward those audio frames (PCM, mu-law, Opus, depending on the negotiated format) to the Vapi WebSocket.
3. Relay the audio frames that Vapi streams back to the telephony provider so the caller hears the assistant in real time.

## 4. Handle Real-Time Events
1. Listen for JSON events from Vapi alongside the audio, such as partial transcripts, final messages, or tool calls.
2. When Vapi issues a tool call (e.g., `schedule_google_calendar_event`), invoke the appropriate downstream service or internal API from your backend.
3. Note the `toolCallId` from the event but do **not** send the result back over the WebSocket. Vapi expects tool executions to be resolved via the HTTP webhook.
4. Vapi will POST the tool payload to your configured webhook (`POST /voice/vapi/tool`). Reply with HTTP 200 and the following shape so the assistant can continue the conversation:

   ```json
   {
     "results": [
       {
         "toolCallId": "call_123",
         "result": "Single-line string result"
       }
     ]
   }
   ```

   - The array is mandatory, even when returning a single result.
   - `toolCallId` must match the ID Vapi sent in the webhook.
   - `result` should be a single-line string; stringify objects yourself and strip newline characters.

## 5. Manage Call Lifecycle
1. When the telephony provider signals that the call ended, close the Vapi WebSocket connection.
2. If Vapi closes the WebSocket, tear down any telephony streams to avoid dangling connections.
3. Always clean up resources (streams, sockets, timers) on both sides to keep the system stable.

## Summary Flow
1. Telephony provider establishes a call and streams audio to your backend.
2. Backend requests a WebSocket-based call from Vapi (`POST /call`).
3. Backend connects to `websocketCallUrl` with credentials.
4. Audio and events flow bidirectionally between telephony, backend, and Vapi.
5. Backend mediates tool calls and call termination.

With this setup, your backend acts as the bridge between the caller and Vapi's AI assistant, ensuring audio and events are relayed seamlessly in real time.
