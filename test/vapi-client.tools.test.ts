import 'reflect-metadata';
import { VapiClient, VapiRealtimeCallbacks, NormalizedToolCall } from '../src/clients/VapiClient';
import { GoogleService } from '../src/business/services/GoogleService';
import { CompanyModel } from '../src/business/models/CompanyModel';
import { ReplyStyleModel } from '../src/business/models/ReplyStyleModel';
import { ReplyStyleEnum } from '../src/utils/enums/ReplyStyleEnum';
import { ReplyStyleDescriptionEnum } from '../src/utils/enums/ReplyStyleDescriptionEnum';
import { VoiceSettingModel } from '../src/business/models/VoiceSettingsModel';

describe('VapiClient tool dispatcher', () => {
  let googleService: jest.Mocked<GoogleService>;
  let client: VapiClient;
  let session: { sendToolResponse: jest.Mock };
  let baseCallbacks: VapiRealtimeCallbacks;

  const createCompany = (hasGoogleIntegration = true) => {
    const company = new CompanyModel(1n, 'Test Company', 'info@test.com', '+31123456789', new Date(), new Date(), 'assistant-1');
    const replyStyle = new ReplyStyleModel(
      1,
      1,
      ReplyStyleEnum.Professional,
      ReplyStyleDescriptionEnum.Professional,
    );
    const companyContext: any = {
      details: { industry: 'Dental', description: 'Test description' },
      contact: { contact_email: 'info@test.com', phone: '+31123456789' },
      hours: [
        { dayOfWeek: 1, isOpen: true, openTime: '09:00', closeTime: '17:00' },
        { dayOfWeek: 2, isOpen: true, openTime: '09:00', closeTime: '17:00' },
      ],
      info: [],
    };
    const schedulingContext: any = { appointmentTypes: [], staffMembers: [] };
    const voiceSettings = new VoiceSettingModel(1, 1, 'Welkom', 1, 'voice-1');

    client.setCompanyInfo(
      company,
      hasGoogleIntegration,
      replyStyle,
      companyContext,
      schedulingContext,
      voiceSettings,
    );
  };

  beforeEach(() => {
    googleService = {
      scheduleEvent: jest.fn(),
      getAvailableSlots: jest.fn(),
      cancelEvent: jest.fn(),
    } as unknown as jest.Mocked<GoogleService>;

    client = new VapiClient(googleService);
    session = { sendToolResponse: jest.fn() };
    baseCallbacks = { onAudio: jest.fn() };
    createCompany();
  });

  const execute = async (
    call: NormalizedToolCall,
    callbacks: VapiRealtimeCallbacks = baseCallbacks,
  ) => {
    await (client as any).executeToolCall(call, session, callbacks);
  };

  it('invokes transfer call handler and returns success payload', async () => {
    const transferHandler = jest.fn().mockResolvedValue({ transferredTo: '+31881234567', callSid: 'abc' });
    const callbacks: VapiRealtimeCallbacks = { ...baseCallbacks, onTransferCall: transferHandler };

    await execute(
      { id: 'tool-1', name: 'transfer_call', args: { phoneNumber: '+31881234567' } },
      callbacks,
    );

    expect(transferHandler).toHaveBeenCalledWith({
      phoneNumber: '+31881234567',
      callSid: null,
      callerId: null,
      reason: null,
    });
    expect(session.sendToolResponse).toHaveBeenCalledWith('tool-1', {
      success: true,
      data: {
        message: 'Doorverbinden gestart',
        transferredTo: '+31881234567',
        callSid: 'abc',
        reason: null,
      },
    });
  });

  it('injects the active session callSid when the tool request omits it', async () => {
    const transferHandler = jest.fn().mockResolvedValue({});
    const callbacks: VapiRealtimeCallbacks = { ...baseCallbacks, onTransferCall: transferHandler };

    (client as any).sessionContexts.set(session, { callSid: 'CA1234567890', callerNumber: '+31111222333' });

    await execute(
      { id: 'tool-1', name: 'transfer_call', args: { phoneNumber: '+31881234567' } },
      callbacks,
    );

    expect(transferHandler).toHaveBeenCalledWith({
      phoneNumber: '+31881234567',
      callSid: 'CA1234567890',
      callerId: null,
      reason: null,
    });
    expect(session.sendToolResponse).toHaveBeenCalledWith('tool-1', {
      success: true,
      data: {
        message: 'Doorverbinden gestart',
        transferredTo: '+31881234567',
        callSid: 'CA1234567890',
        reason: null,
      },
    });
  });

  it('returns an error when transfer handler is missing', async () => {
    await execute({ id: 'tool-2', name: 'transfer_call', args: { phoneNumber: '+3100000000' } }, baseCallbacks);

    expect(session.sendToolResponse).toHaveBeenCalledWith('tool-2', {
      success: false,
      error: 'Doorverbinden is niet beschikbaar in deze sessie.',
      details: undefined,
    });
  });

  it('sends schedule event request to Google service', async () => {
    const createdEvent = { id: 'event-1' };
    googleService.scheduleEvent.mockResolvedValue(createdEvent as any);

    await execute({
      id: 'tool-3',
      name: 'schedule_google_calendar_event',
      args: {
        summary: 'Consult',
        start: '2024-01-08T09:00:00+01:00',
        end: '2024-01-08T09:30:00+01:00',
        name: 'Jane Doe',
        dateOfBirth: '01-01-1990',
        attendeeEmail: 'jane@example.com',
        description: 'Controle afspraak',
        location: 'Praktijk 1',
      },
    });

    expect(googleService.scheduleEvent).toHaveBeenCalled();
    const [, event] = googleService.scheduleEvent.mock.calls[0];
    expect(event).toMatchObject({
      summary: 'Consult',
      description: expect.stringContaining('Naam: Jane Doe'),
      start: { dateTime: '2024-01-08T09:00:00+01:00' },
      end: { dateTime: '2024-01-08T09:30:00+01:00' },
      attendees: [
        {
          email: 'jane@example.com',
          displayName: 'Jane Doe',
        },
      ],
    });
    expect(session.sendToolResponse).toHaveBeenCalledWith('tool-3', {
      success: true,
      data: { event: createdEvent },
    });
  });

  it('accepts legacy create_calendar_event tool names for backwards compatibility', async () => {
    const createdEvent = { id: 'legacy-event' };
    googleService.scheduleEvent.mockResolvedValue(createdEvent as any);

    await execute({
      id: 'legacy-tool',
      name: 'create_calendar_event',
      args: {
        summary: 'Controle',
        start: '2024-02-01T10:00:00+01:00',
        end: '2024-02-01T10:30:00+01:00',
        name: 'Jan Jansen',
        dateOfBirth: '02-02-1980',
      },
    });

    expect(googleService.scheduleEvent).toHaveBeenCalled();
    expect(session.sendToolResponse).toHaveBeenCalledWith('legacy-tool', {
      success: true,
      data: { event: createdEvent },
    });
  });

  it('requests availability slots with derived business hours', async () => {
    googleService.getAvailableSlots.mockResolvedValue(['09:00', '09:30']);

    await execute({
      id: 'tool-4',
      name: 'check_google_calendar_availability',
      args: { date: '2024-01-08' },
    });

    expect(googleService.getAvailableSlots).toHaveBeenCalledWith(1n, '2024-01-08', 9, 17);
    expect(session.sendToolResponse).toHaveBeenCalledWith('tool-4', {
      success: true,
      data: {
        date: '2024-01-08',
        openHour: 9,
        closeHour: 17,
        slots: ['09:00', '09:30'],
      },
    });
  });

  it('returns an error response when Google service throws', async () => {
    googleService.cancelEvent.mockRejectedValue(new Error('Event not found'));

    await execute({ id: 'tool-5', name: 'cancel_google_calendar_event', args: { eventId: 'evt-1' } });

    expect(session.sendToolResponse).toHaveBeenCalledWith('tool-5', {
      success: false,
      error: 'Event not found',
      details: undefined,
    });
  });

  it('rejects Google tools when integration is disabled', async () => {
    const newClient = new VapiClient(googleService);
    client = newClient;
    session = { sendToolResponse: jest.fn() };
    createCompany(false);

    await (client as any).executeToolCall(
      {
        id: 'tool-6',
        name: 'schedule_google_calendar_event',
        args: { summary: 'A', start: 's', end: 'e', name: 'n', dateOfBirth: 'd' },
      },
      session,
      baseCallbacks,
    );

    expect(session.sendToolResponse).toHaveBeenCalledWith('tool-6', {
      error: 'Google integration not available',
    });
  });
});
