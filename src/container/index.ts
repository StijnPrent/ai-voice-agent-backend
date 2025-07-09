import { container } from "tsyringe";
import { DeepgramClient } from "../clients/DeepgramClient";
import { ChatGPTClient } from "../clients/ChatGPTClient";
import { ElevenLabsClient } from "../clients/ElevenLabsClient";
import { TwilioClient } from "../clients/TwilioClient";
import {VoiceService} from "../business/services/VoiceService";
import {GoogleService} from "../business/services/GoogleService";
import {CompanyService} from "../business/services/CompanyService";
import {ICompanyRepository} from "../data/interfaces/ICompanyRepository";
import {CompanyRepository} from "../data/repositories/CompanyRepository";
import {IGoogleRepository} from "../data/interfaces/IGoogleRepository";
import {GoogleRepository} from "../data/repositories/GoogleRepository";
import {GoogleCalendarClient} from "../clients/GoogleCalenderClient";
import {PasswordRepository} from "../data/repositories/PasswordRepository";
import {VoiceRepository} from "../data/repositories/VoiceRepository";
import {VoiceSettingModel} from "../business/models/VoiceSettingsModel";
import {IntegrationRepository} from "../data/repositories/IntegrationRepository";
import {IntegrationService} from "../business/services/IntegrationService";

// Register all clients in the container
container.register("DeepgramClient", { useClass: DeepgramClient });
container.register("ChatGPTClient", { useClass: ChatGPTClient });
container.register("ElevenLabsClient", { useClass: ElevenLabsClient });
container.register("TwilioClient", { useClass: TwilioClient });
container.register("GoogleCalendarClient", {
    useFactory: () =>
        new GoogleCalendarClient()
});

// Register business services
container.register("VoiceService", { useClass: VoiceService });
container.register("GoogleService", { useClass: GoogleService });
container.register("CompanyService", { useClass: CompanyService });
container.register("VoiceSettingsService", { useClass: VoiceSettingModel });
container.register("IntegrationService", { useClass: IntegrationService });

// Register data repositories
container.register<ICompanyRepository>("ICompanyRepository", {
    useClass: CompanyRepository,
});
container.register<IGoogleRepository>("IGoogleRepository", {
    useClass: GoogleRepository,
});
container.register("IPasswordRepository", {
    useClass: PasswordRepository,
})
container.register("IVoiceRepository", {
    useClass: VoiceRepository,
})
container.register("IIntegrationRepository", {
    useClass: IntegrationRepository,
})