import { container } from "tsyringe";
import { VapiClient } from "../clients/VapiClient";
import { TwilioClient } from "../clients/TwilioClient";
import {VoiceService} from "../business/services/VoiceService";
import { VoiceSessionManager } from "../business/services/VoiceSessionManager";
import {GoogleService} from "../business/services/GoogleService";
import {CompanyService} from "../business/services/CompanyService";
import { VoiceSettingsService } from "../business/services/VoiceSettingsService";
import {ICompanyRepository} from "../data/interfaces/ICompanyRepository";
import {CompanyRepository} from "../data/repositories/CompanyRepository";
import {IGoogleRepository} from "../data/interfaces/IGoogleRepository";
import {GoogleRepository} from "../data/repositories/GoogleRepository";
import {GoogleCalendarClient} from "../clients/GoogleCalenderClient";
import {PasswordRepository} from "../data/repositories/PasswordRepository";
import {VoiceRepository} from "../data/repositories/VoiceRepository";
import {IntegrationRepository} from "../data/repositories/IntegrationRepository";
import {IntegrationService} from "../business/services/IntegrationService";
import {UpdateService} from "../business/services/UpdateService";
import {IUpdateRepository} from "../data/interfaces/IUpdateRepository";
import {UpdateRepository} from "../data/repositories/UpdateRepository";
import {OutlookCalendarClient} from "../clients/OutlookCalendarClient";
import {OutlookService} from "../business/services/OutlookService";
import {IOutlookRepository} from "../data/interfaces/IOutlookRepository";
import {OutlookRepository} from "../data/repositories/OutlookRepository";
import {SchedulingService} from "../business/services/SchedulingService";
import {ISchedulingRepository} from "../data/interfaces/ISchedulingRepository";
import {SchedulingRepository} from "../data/repositories/SchedulingRepository";
import { AssistantSyncService } from "../business/services/AssistantSyncService";
import { UsageService } from "../business/services/UsageService";
import { IUsageRepository } from "../data/interfaces/IUsageRepository";
import { UsageRepository } from "../data/repositories/UsageRepository";
import { CallLogService } from "../business/services/CallLogService";
import { ICallLogRepository } from "../data/interfaces/ICallLogRepository";
import { CallLogRepository } from "../data/repositories/CallLogRepository";
import { AnalyticsService } from "../business/services/AnalyticsService";
import { IAnalyticsRepository } from "../data/interfaces/IAnalyticsRepository";
import { AnalyticsRepository } from "../data/repositories/AnalyticsRepository";
import { VapiSessionRegistry } from "../business/services/VapiSessionRegistry";
import { IVapiSessionRepository } from "../data/interfaces/IVapiSessionRepository";
import { VapiSessionRepository } from "../data/repositories/VapiSessionRepository";
import { VapiRoute } from "../routes/VapiRoute";
import { AdminService } from "../business/services/AdminService";
import { IAdminRepository } from "../data/interfaces/IAdminRepository";
import { AdminRepository } from "../data/repositories/AdminRepository";
import { SalesPipelineService } from "../business/services/SalesPipelineService";
import { ISalesPipelineRepository } from "../data/interfaces/ISalesPipelineRepository";
import { SalesPipelineRepository } from "../data/repositories/SalesPipelineRepository";
import { IMailClient } from "../clients/MailClient";
import { DevConsoleMailClient } from "../clients/DevConsoleMailClient";
import { ResendMailClient } from "../clients/ResendMailClient";
import config from "../config/config";
import { MailService } from "../business/services/MailService";
import { MailTemplateService } from "../business/services/MailTemplateService";
import { IMailLogRepository } from "../data/interfaces/IMailLogRepository";
import { MailLogRepository } from "../data/repositories/MailLogRepository";
import { TransactionalMailService } from "../business/services/TransactionalMailService";
import { IAuthTokenRepository } from "../data/interfaces/IAuthTokenRepository";
import { AuthTokenRepository } from "../data/repositories/AuthTokenRepository";
import { IEarlyAccessRepository } from "../data/interfaces/IEarlyAccessRepository";
import { EarlyAccessRepository } from "../data/repositories/EarlyAccessRepository";
import { EarlyAccessService } from "../business/services/EarlyAccessService";
import { LeadAgentService } from "../business/services/LeadAgentService";
import { ShopifyService } from "../business/services/ShopifyService";
import { WooCommerceService } from "../business/services/WooCommerceService";
import { IShopifyRepository } from "../data/interfaces/IShopifyRepository";
import { ShopifyRepository } from "../data/repositories/ShopifyRepository";
import { IWooCommerceRepository } from "../data/interfaces/IWooCommerceRepository";
import { WooCommerceRepository } from "../data/repositories/WooCommerceRepository";
import { CommerceController } from "../controllers/CommerceController";
import { BillingService } from "../business/services/BillingService";
import { IBillingRepository } from "../data/interfaces/IBillingRepository";
import { BillingRepository } from "../data/repositories/BillingRepository";
import { ProductKnowledgeService } from "../business/services/ProductKnowledgeService";
import { IProductKnowledgeRepository } from "../data/interfaces/IProductKnowledgeRepository";
import { ProductKnowledgeRepository } from "../data/repositories/ProductKnowledgeRepository";
import { AssistantContextBuilder } from "../business/services/AssistantContextBuilder";
import { WhatsappClient } from "../clients/WhatsappClient";
import { WhatsappIntegrationService } from "../business/services/WhatsappIntegrationService";
import { WhatsappChatService } from "../business/services/WhatsappChatService";
import { IWhatsappIntegrationRepository } from "../data/interfaces/IWhatsappIntegrationRepository";
import { WhatsappIntegrationRepository } from "../data/repositories/WhatsappIntegrationRepository";
import { IWhatsappConversationRepository } from "../data/interfaces/IWhatsappConversationRepository";
import { WhatsappConversationRepository } from "../data/repositories/WhatsappConversationRepository";

// Register all clients in the container
container.register(VapiClient, { useClass: VapiClient });
container.register("TwilioClient", { useClass: TwilioClient });
container.register("GoogleCalendarClient", {
    useFactory: () =>
        new GoogleCalendarClient()
});
container.register("OutlookCalendarClient", {
    useFactory: () =>
        new OutlookCalendarClient()
});
container.register(WhatsappClient, { useClass: WhatsappClient });

// Register business services
container.registerSingleton(VoiceSessionManager, VoiceSessionManager);
container.registerSingleton(VapiSessionRegistry, VapiSessionRegistry);
container.registerSingleton(VapiRoute, VapiRoute);
container.register(VoiceService, { useClass: VoiceService });
container.register(GoogleService, { useClass: GoogleService });
container.register("OutlookService", { useClass: OutlookService });
container.register(CompanyService, { useClass: CompanyService });
container.registerSingleton(VoiceSettingsService, VoiceSettingsService);
container.register(IntegrationService, { useClass: IntegrationService });
container.register(UpdateService, { useClass: UpdateService });
container.register(SchedulingService, { useClass: SchedulingService });
container.register(AssistantSyncService, { useClass: AssistantSyncService });
container.register(UsageService, { useClass: UsageService });
container.register(CallLogService, { useClass: CallLogService });
container.register(AnalyticsService, { useClass: AnalyticsService });
container.register(AdminService, { useClass: AdminService });
container.register(SalesPipelineService, { useClass: SalesPipelineService });
container.register(MailService, { useClass: MailService });
container.register(MailTemplateService, { useClass: MailTemplateService });
container.register(TransactionalMailService, { useClass: TransactionalMailService });
container.register(EarlyAccessService, { useClass: EarlyAccessService });
container.register(LeadAgentService, { useClass: LeadAgentService });
container.register(ShopifyService, { useClass: ShopifyService });
container.register(WooCommerceService, { useClass: WooCommerceService });
container.register(CommerceController, { useClass: CommerceController });
container.register(BillingService, { useClass: BillingService });
container.register(ProductKnowledgeService, { useClass: ProductKnowledgeService });
container.register(AssistantContextBuilder, { useClass: AssistantContextBuilder });
container.register(WhatsappIntegrationService, { useClass: WhatsappIntegrationService });
container.register(WhatsappChatService, { useClass: WhatsappChatService });

// Register data repositories
container.register<ICompanyRepository>("ICompanyRepository", {
    useClass: CompanyRepository,
});
container.register<IGoogleRepository>("IGoogleRepository", {
    useClass: GoogleRepository,
});
container.register<IOutlookRepository>("IOutlookRepository", {
    useClass: OutlookRepository,
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
container.register<IUpdateRepository>("IUpdateRepository", {
    useClass: UpdateRepository,
})
container.register<ISchedulingRepository>("ISchedulingRepository", {
    useClass: SchedulingRepository,
})
container.register<IUsageRepository>("IUsageRepository", {
    useClass: UsageRepository,
})
container.register<ICallLogRepository>("ICallLogRepository", {
    useClass: CallLogRepository,
})
container.register<IAnalyticsRepository>("IAnalyticsRepository", {
    useClass: AnalyticsRepository,
})
container.register<IVapiSessionRepository>("IVapiSessionRepository", {
    useClass: VapiSessionRepository,
})
container.register<IAdminRepository>("IAdminRepository", {
    useClass: AdminRepository,
})
container.register<ISalesPipelineRepository>("ISalesPipelineRepository", {
    useClass: SalesPipelineRepository,
})
container.register<IMailLogRepository>("IMailLogRepository", {
    useClass: MailLogRepository,
})
container.register<IAuthTokenRepository>("IAuthTokenRepository", {
    useClass: AuthTokenRepository,
})
container.register<IEarlyAccessRepository>("IEarlyAccessRepository", {
    useClass: EarlyAccessRepository,
})
container.register<IShopifyRepository>("IShopifyRepository", {
    useClass: ShopifyRepository,
})
container.register<IWooCommerceRepository>("IWooCommerceRepository", {
    useClass: WooCommerceRepository,
})
container.register<IBillingRepository>("IBillingRepository", {
    useClass: BillingRepository,
})
container.register<IProductKnowledgeRepository>("IProductKnowledgeRepository", {
    useClass: ProductKnowledgeRepository,
})
container.register<IWhatsappIntegrationRepository>("IWhatsappIntegrationRepository", {
    useClass: WhatsappIntegrationRepository,
})
container.register<IWhatsappConversationRepository>("IWhatsappConversationRepository", {
    useClass: WhatsappConversationRepository,
})

// Mail Client selection
const mailProvider = (process.env.MAIL_PROVIDER || (config as any).mailProvider || "resend").toLowerCase();
container.register<IMailClient>("IMailClient", {
    useClass: mailProvider === "dev" ? DevConsoleMailClient : ResendMailClient,
});
