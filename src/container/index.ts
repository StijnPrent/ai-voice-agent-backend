import { container } from "tsyringe";
import { WhisperClient } from "../clients/WhisperClient";
import { ChatGPTClient } from "../clients/ChatGPTClient";
import { ElevenLabsClient } from "../clients/ElevenLabsClient";
import { TwilioClient } from "../clients/TwilioClient";

container.register("WhisperClient", { useClass: WhisperClient });
container.register("ChatGPTClient", { useClass: ChatGPTClient });
container.register("ElevenLabsClient", { useClass: ElevenLabsClient });
container.register("TwilioClient", { useClass: TwilioClient });