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

// Register all clients and services in the container
container.register("DeepgramClient", { useClass: DeepgramClient });
container.register("ChatGPTClient", { useClass: ChatGPTClient });
container.register("ElevenLabsClient", { useClass: ElevenLabsClient });
container.register("TwilioClient", { useClass: TwilioClient });
container.register("GoogleCalendarClient", {
    useFactory: () =>
        new GoogleCalendarClient(
            process.env.GOOGLE_CLIENT_ID!,
            process.env.GOOGLE_CLIENT_SECRET!
        ),
});

// Register business services
container.register("VoiceService", { useClass: VoiceService });
container.register("GoogleService", { useClass: GoogleService });
container.register("CompanyService", { useClass: CompanyService });

// Register data repositories
container.register<ICompanyRepository>("ICompanyRepository", {
    useClass: CompanyRepository,
});
container.register<IGoogleRepository>("IGoogleRepository", {
    useClass: GoogleRepository,
});