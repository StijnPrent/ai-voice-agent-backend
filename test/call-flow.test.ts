
import 'reflect-metadata';
import { WebSocketServer } from '../src/websocket/WebSocketServer';
import { VoiceService } from '../src/business/services/VoiceService';
import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';

// We don't need to mock the individual clients anymore,
// as we will be creating a complete mock of VoiceService.
jest.mock('ws');

describe('WebSocketServer Call Flow', () => {
    let webSocketServer: WebSocketServer;
    let mockVoiceService: jest.Mocked<VoiceService>;
    let mockWs: jest.Mocked<WebSocket>;

    beforeEach(() => {
        // Create a complete mock of VoiceService
        mockVoiceService = {
            startStreaming: jest.fn(),
            sendAudio: jest.fn(),
            handleMark: jest.fn(),
            stopStreaming: jest.fn(),
        } as any;

        // Create the WebSocketServer with the mocked VoiceService
        webSocketServer = new WebSocketServer(mockVoiceService);
        webSocketServer.start();

        // Mock the WebSocket object that will be created
        mockWs = new (WebSocket as any)() as jest.Mocked<WebSocket>;
        mockWs.on = jest.fn();
        mockWs.send = jest.fn();
        mockWs.close = jest.fn();
        mockWs.removeListener = jest.fn();

        // Mock the server's upgrade handler to emit our mock client
        const mockWss = {
            handleUpgrade: jest.fn((_req, _socket, _head, callback) => {
                callback(mockWs);
            }),
            emit: jest.fn(),
        };
        (webSocketServer as any).wss = mockWss;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should handle the full call flow via WebSocket events', async () => {
        // 1. Simulate connection upgrade
        const mockRequest = {
            url: '/ws?to=+1234567890',
            headers: {
                host: 'localhost'
            }
        } as IncomingMessage;
        const mockSocket = {
            write: jest.fn(),
            destroy: jest.fn(),
        } as unknown as Duplex;
        const mockHead = Buffer.alloc(0);
        webSocketServer.handleUpgrade(mockRequest, mockSocket, mockHead);

        // Verify handleUpgrade called the ws library's handler
        expect((webSocketServer as any).wss.handleUpgrade).toHaveBeenCalled();

        // Capture the message handler registered by our server
        const messageCallback = (mockWs.on as jest.Mock).mock.calls.find(call => call[0] === 'message')[1];

        // 2. Simulate 'start' event from Twilio
        const startEvent = {
            event: 'start',
            start: { callSid: 'call123', streamSid: 'stream456' }
        };
        await messageCallback(JSON.stringify(startEvent));
        expect(mockVoiceService.startStreaming).toHaveBeenCalledWith(
            mockWs,
            'call123',
            'stream456',
            '+1234567890',
            startEvent
        );
        expect(mockWs.removeListener).toHaveBeenCalledWith('message', messageCallback);

        // After handing over to the voice service, the WebSocketServer should not
        // directly invoke downstream handlers for additional events.
        const mediaEvent = {
            event: 'media',
            media: { payload: 'audio_data_base64' }
        };
        await messageCallback(JSON.stringify(mediaEvent));
        expect(mockVoiceService.sendAudio).not.toHaveBeenCalled();

        const markEvent = {
            event: 'mark',
            mark: { name: 'mark1' }
        };
        await messageCallback(JSON.stringify(markEvent));
        expect(mockVoiceService.handleMark).not.toHaveBeenCalled();

        const stopEvent = {
            event: 'stop',
            stop: { callSid: 'call123' }
        };
        await messageCallback(JSON.stringify(stopEvent));
        expect(mockVoiceService.stopStreaming).not.toHaveBeenCalled();

        // 6. Simulate connection close
        const closeCallback = (mockWs.on as jest.Mock).mock.calls.find(call => call[0] === 'close')[1];
        await closeCallback();
        expect(mockVoiceService.stopStreaming).toHaveBeenCalledTimes(1);
    });

    it("should reject connections without a valid 'to' parameter", () => {
        const mockRequest = {
            url: '/ws',
            headers: {
                host: 'localhost'
            }
        } as IncomingMessage;
        const mockSocket = {
            write: jest.fn(),
            destroy: jest.fn(),
        } as unknown as Duplex;
        const mockHead = Buffer.alloc(0);

        webSocketServer.handleUpgrade(mockRequest, mockSocket, mockHead);

        expect(mockSocket.write).toHaveBeenCalledWith("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        expect(mockSocket.destroy).toHaveBeenCalled();
        expect((webSocketServer as any).wss.handleUpgrade).not.toHaveBeenCalled();
    });

    it('should accept the first valid number when multiple to parameters are provided', async () => {
        const mockRequest = {
            url: '/ws?to=&to=+1987654321',
            headers: {
                host: 'localhost'
            }
        } as IncomingMessage;
        const mockSocket = {
            write: jest.fn(),
            destroy: jest.fn(),
        } as unknown as Duplex;
        const mockHead = Buffer.alloc(0);

        webSocketServer.handleUpgrade(mockRequest, mockSocket, mockHead);

        expect((webSocketServer as any).wss.handleUpgrade).toHaveBeenCalled();
        const messageCallback = (mockWs.on as jest.Mock).mock.calls.find(call => call[0] === 'message')[1];
        const startEvent = {
            event: 'start',
            start: { callSid: 'call123', streamSid: 'stream456' }
        };

        await messageCallback(JSON.stringify(startEvent));

        expect(mockVoiceService.startStreaming).toHaveBeenCalledWith(
            mockWs,
            'call123',
            'stream456',
            '+1987654321',
            startEvent
        );
    });
});
