
import 'reflect-metadata';
import { WebSocketServer } from '../src/websocket/WebSocketServer';
import { VoiceService } from '../src/business/services/VoiceService';
import { VoiceSessionManager } from '../src/business/services/VoiceSessionManager';
import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';

// We don't need to mock the individual clients anymore,
// as we will be creating a complete mock of VoiceService.
jest.mock('ws');

describe('WebSocketServer Call Flow', () => {
    let webSocketServer: WebSocketServer;
    let mockVoiceService: jest.Mocked<VoiceService>;
    let stopStreamingMock: jest.Mock;
    let mockSessionManager: jest.Mocked<VoiceSessionManager>;
    let mockWs: jest.Mocked<WebSocket>;

    beforeEach(() => {
        // Create a complete mock of VoiceService
        stopStreamingMock = jest.fn();
        mockVoiceService = {
            startStreaming: jest.fn(),
            sendAudio: jest.fn(),
            handleMark: jest.fn(),
            stopStreaming: stopStreamingMock as any,
        } as any;

        mockSessionManager = {
            createSession: jest.fn().mockReturnValue(mockVoiceService),
            getSession: jest.fn(),
            resolveActiveSession: jest.fn(),
            releaseSession: jest.fn(),
            listActiveCallSids: jest.fn().mockReturnValue([]),
        } as unknown as jest.Mocked<VoiceSessionManager>;

        // Create the WebSocketServer with the mocked session manager
        webSocketServer = new WebSocketServer(mockSessionManager);
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
            start: {
                callSid: 'call123',
                streamSid: 'stream456',
                customParameters: { to: '1234567890' },
            },
        };
        await messageCallback(JSON.stringify(startEvent));
        expect(mockSessionManager.createSession).toHaveBeenCalledWith('call123');
        expect(mockVoiceService.startStreaming).toHaveBeenCalledWith(
            mockWs,
            'call123',
            'stream456',
            '1234567890',
            undefined,
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
        expect(stopStreamingMock).toHaveBeenCalledTimes(1);
    });

    it("should reject connections without a valid 'to' parameter", async () => {
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

        expect((webSocketServer as any).wss.handleUpgrade).toHaveBeenCalled();
        const messageCallback = (mockWs.on as jest.Mock).mock.calls.find(call => call[0] === 'message')[1];

        const startEvent = {
            event: 'start',
            start: {
                callSid: 'call123',
                streamSid: 'stream456',
            },
        };

        await messageCallback(JSON.stringify(startEvent));

        expect(mockSessionManager.createSession).not.toHaveBeenCalled();
        expect(mockWs.close).toHaveBeenCalledWith(1008, expect.stringContaining("'to'"));
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
            start: {
                callSid: 'call123',
                streamSid: 'stream456',
                customParameters: { to: '1987654321' },
            },
        };

        await messageCallback(JSON.stringify(startEvent));
        expect(mockSessionManager.createSession).toHaveBeenCalledWith('call123');

        expect(mockVoiceService.startStreaming).toHaveBeenCalledWith(
            mockWs,
            'call123',
            'stream456',
            '1987654321',
            undefined,
            startEvent
        );
    });
});
