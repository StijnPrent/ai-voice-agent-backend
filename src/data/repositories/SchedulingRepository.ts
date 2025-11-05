// src/data/repositories/SchedulingRepository.ts
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";

import { AppointmentTypeModel } from "../../business/models/AppointmentTypeModel";
import { StaffMemberModel } from "../../business/models/StaffMemberModel";
import { SpecialtyModel } from "../../business/models/SpecialtyModel";
import { StaffAvailabilityModel } from "../../business/models/StaffAvailabilityModel";
import { ISchedulingRepository } from "../interfaces/ISchedulingRepository";

export class SchedulingRepository extends BaseRepository implements ISchedulingRepository {
    /* ----------------------------- Appointment Types ----------------------------- */

    public async addAppointmentType(model: AppointmentTypeModel): Promise<number> {
        const sql = `
            INSERT INTO appointment_types
            (company_id, service_name, duration, price, category, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        const res = await this.execute<ResultSetHeader>(sql, [
            model.companyId,
            model.name,
            model.duration,
            model.price ?? null,
            model.category ?? null,
            model.description ?? null
        ]);
        return res.insertId;
    }

    public async updateAppointmentType(model: AppointmentTypeModel): Promise<void> {
        const sql = `
            UPDATE appointment_types
            SET service_name = ?, duration = ?, price = ?, category = ?, description = ?, updated_at = NOW()
            WHERE id = ? AND company_id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [
            model.name,
            model.duration,
            model.price ?? null,
            model.category ?? null,
            model.description ?? null,
            model.id,
            model.companyId
        ]);
    }

    public async deleteAppointmentType(companyId: bigint, id: number): Promise<void> {
        const sql = `DELETE FROM appointment_types WHERE id = ? AND company_id = ?`;
        await this.execute<ResultSetHeader>(sql, [id, companyId]);
    }

    public async fetchAppointmentTypes(companyId: bigint): Promise<AppointmentTypeModel[]> {
        const sql = `
            SELECT id, company_id, service_name, duration, price, category, description, created_at, updated_at
            FROM appointment_types
            WHERE company_id = ?
            ORDER BY service_name
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        return rows.map(r => new AppointmentTypeModel(
            r.id,
            BigInt(r.company_id),
            r.service_name,
            r.duration,
            r.price,
            r.category,
            r.description,
            r.created_at,
            r_updated_at(r) // helper voor compat (kan ontbreken)
        ));
    }

    /* --------------------------------- Staff ---------------------------------- */

    /**
     * Maak medewerker. Specialties en availability (optioneel) worden meteen gezet.
     * Retourneert nieuw staffId.
     */
    public async addStaffMember(model: StaffMemberModel): Promise<number> {
        const activeFlag = this.computeActiveFlag(model.availability);

        const sql = `
            INSERT INTO staff_members
                (company_id, name, role_title, google_calendar_id, google_calendar_summary, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        `;
        const res = await this.execute<ResultSetHeader>(sql, [
            model.companyId,
            model.name,
            model.role,
            model.googleCalendarId ?? null,
            model.googleCalendarSummary ?? null
        ]);
        const staffId = res.insertId;

        if (model.specialties?.length) {
            await this.setStaffSpecialtiesFromModels(staffId, model.specialties);
        }
        if (model.availability?.length) {
            // availability schrijft staff_id mee (hier staffId)
            await this.setStaffAvailabilityFromModels(staffId, model.availability);
        }
        return staffId;
    }

    /**
     * Update medewerker. Wanneer specialties of availability zijn meegegeven,
     * vervangen ze de volledige bestaande set (replace-all).
     */
    public async updateStaffMember(model: StaffMemberModel): Promise<void> {
        const sets: string[] = [
            "name = ?",
            "role_title = ?",
            "google_calendar_id = ?",
            "google_calendar_summary = ?",
            "updated_at = NOW()"
        ];
        const params: any[] = [
            model.name,
            model.role,
            model.googleCalendarId ?? null,
            model.googleCalendarSummary ?? null
        ];

        const sql = `
            UPDATE staff_members
            SET ${sets.join(", ")}
            WHERE id = ? AND company_id = ?
        `;
        params.push(model.id, model.companyId);
        await this.execute<ResultSetHeader>(sql, params);

        if (Array.isArray(model.specialties)) {
            await this.setStaffSpecialtiesFromModels(model.id, model.specialties);
        }
        if (Array.isArray(model.availability)) {
            await this.setStaffAvailabilityFromModels(model.id, model.availability);
        }
    }

    public async deleteStaffMember(companyId: bigint, staffId: number): Promise<void> {
        const sql = `DELETE FROM staff_members WHERE id = ? AND company_id = ?`;
        await this.execute<ResultSetHeader>(sql, [staffId, companyId]);
    }

    /**
     * Haalt ALLE medewerkers op:
     * - specialties (tags)
     * - availability (per dag)
     * in één call; geen aparte endpoints nodig.
     */
    public async fetchStaffMembers(companyId: bigint): Promise<StaffMemberModel[]> {
        // Eerst medewerkers + specialties
        const baseSql = `
            SELECT
                sm.id AS staff_id, sm.company_id, sm.name, sm.role_title,
                sm.google_calendar_id, sm.google_calendar_summary,
                sm.created_at, sm.updated_at,
                s.id AS spec_id, s.name AS spec_name
            FROM staff_members sm
                     LEFT JOIN staff_specialties ss ON ss.staff_id = sm.id
                     LEFT JOIN specialties s ON s.id = ss.specialty_id
            WHERE sm.company_id = ?
            ORDER BY sm.name, s.name
        `;
        const rows = await this.execute<RowDataPacket[]>(baseSql, [companyId]);

        const map = new Map<number, StaffMemberModel>();
        for (const r of rows) {
            let model = map.get(r.staff_id);
            if (!model) {
                model = new StaffMemberModel(
                    r.staff_id,
                    BigInt(r.company_id),
                    r.name,
                    [], // specialties vullen we direct hieronder
                    r.role_title,
                    [], // availability vullen we in tweede query
                    typeof r.google_calendar_id === "string" && r.google_calendar_id.trim().length > 0
                        ? r.google_calendar_id.trim()
                        : null,
                    typeof r.google_calendar_summary === "string" && r.google_calendar_summary.trim().length > 0
                        ? r.google_calendar_summary.trim()
                        : null,
                    r.created_at,
                    r.updated_at
                );
                map.set(r.staff_id, model);
            }
            if (r.spec_id && r.spec_name) {
                model.specialties.push(new SpecialtyModel(r.spec_id, r.spec_name));
            }
        }

        // Dan alle availability voor deze medewerkers ophalen en in de modellen stoppen
        const staffIds = Array.from(map.keys());
        if (staffIds.length > 0) {
            const placeholders = staffIds.map(() => "?").join(",");
            const availSql = `
                SELECT
                    id, staff_id, day_of_week, is_active, start_time, end_time
                FROM staff_availability
                WHERE staff_id IN (${placeholders})
                ORDER BY staff_id, day_of_week
            `;
            const availRows = await this.execute<RowDataPacket[]>(availSql, staffIds);

            for (const a of availRows) {
                const m = map.get(a.staff_id);
                if (!m) continue;
                m.availability.push(
                    new StaffAvailabilityModel(
                        a.id,
                        a.staff_id,
                        a.day_of_week,
                        a.is_active === 1,
                        a.start_time,
                        a.end_time
                    )
                );
            }
        }

        return Array.from(map.values());
    }

    /* ------------------------------ Specialties ------------------------------- */

    /** Upsert specialties op naam en retourneer ids in dezelfde volgorde. */
    private async upsertSpecialties(names: string[]): Promise<number[]> {
        if (!names || names.length === 0) return [];

        const values = names.map(() => "(?)").join(",");
        const insertSql = `
            INSERT INTO specialties (name)
            VALUES ${values}
                ON DUPLICATE KEY UPDATE name = VALUES(name)
        `;
        await this.execute<ResultSetHeader>(insertSql, names);

        const selectSql = `
            SELECT id, name
            FROM specialties
            WHERE name IN (${names.map(() => "?").join(",")})
        `;
        const rows = await this.execute<RowDataPacket[]>(selectSql, names);
        const byName = new Map(rows.map(r => [r.name as string, r.id as number]));
        return names.map(n => byName.get(n)!);
    }

    /**
     * Vervang alle specialties voor een medewerker door de opgegeven set.
     */
    public async setStaffSpecialtiesFromModels(staffId: number, specialties: SpecialtyModel[]): Promise<void> {
        const withIds = specialties.filter(s => typeof s.id === "number" && s.id > 0);
        const withoutIds = specialties.filter(s => !(typeof s.id === "number" && s.id > 0));

        const desiredIds: number[] = [
            ...withIds.map(s => s.id as number),
            ...(withoutIds.length ? await this.upsertSpecialties(withoutIds.map(s => s.name)) : [])
        ];

        // Huidige links
        const curSql = `SELECT specialty_id FROM staff_specialties WHERE staff_id = ?`;
        const curRows = await this.execute<RowDataPacket[]>(curSql, [staffId]);
        const current = new Set<number>(curRows.map(r => r.specialty_id as number));
        const desired = new Set<number>(desiredIds);

        // Toevoegen
        const toAdd = [...desired].filter(id => !current.has(id));
        if (toAdd.length > 0) {
            const values = toAdd.map(() => "(?, ?)").join(",");
            const addSql = `INSERT INTO staff_specialties (staff_id, specialty_id) VALUES ${values}`;
            const params: any[] = [];
            toAdd.forEach(id => params.push(staffId, id));
            await this.execute<ResultSetHeader>(addSql, params);
        }

        // Verwijderen
        const toRemove = [...current].filter(id => !desired.has(id));
        if (toRemove.length > 0) {
            const delSql = `
                DELETE FROM staff_specialties
                WHERE staff_id = ? AND specialty_id IN (${toRemove.map(() => "?").join(",")})
            `;
            await this.execute<ResultSetHeader>(delSql, [staffId, ...toRemove]);
        }
    }

    /* --------------------------- Staff Availability ---------------------------- */

    /**
     * Vervang alle availability regels voor deze medewerker door de opgegeven set.
     * Verwacht items met: dayOfWeek (0..6), isActive, startTime, endTime.
     */
    public async setStaffAvailabilityFromModels(staffId: number, availability: StaffAvailabilityModel[]): Promise<void> {
        // Simpelste en veiligste: full-replace
        const delSql = `DELETE FROM staff_availability WHERE staff_id = ?`;
        await this.execute<ResultSetHeader>(delSql, [staffId]);

        if (!availability || availability.length === 0) return;

        const values = availability.map(() => "(?, ?, ?, ?, ?)").join(",");
        const insSql = `
            INSERT INTO staff_availability
                (staff_id, day_of_week, is_active, start_time, end_time)
            VALUES ${values}
        `;
        const params: any[] = [];
        for (const a of availability) {
            params.push(
                staffId,
                a.dayOfWeek,
                a.isActive ? 1 : 0,
                a.startTime,
                a.endTime
            );
        }
        await this.execute<ResultSetHeader>(insSql, params);
    }

    /* --------------------------- Staff ↔ Services ---------------------------- */

    public async linkStaffToService(staffId: number, appointmentTypeId: number): Promise<void> {
        const sql = `
            INSERT INTO staff_services (staff_id, appointment_type_id)
            VALUES (?, ?)
                ON DUPLICATE KEY UPDATE appointment_type_id = VALUES(appointment_type_id)
        `;
        await this.execute<ResultSetHeader>(sql, [staffId, appointmentTypeId]);
    }

    public async unlinkStaffFromService(staffId: number, appointmentTypeId: number): Promise<void> {
        const sql = `DELETE FROM staff_services WHERE staff_id = ? AND appointment_type_id = ?`;
        await this.execute<ResultSetHeader>(sql, [staffId, appointmentTypeId]);
    }

    public async getStaffServiceIds(staffId: number): Promise<number[]> {
        const sql = `SELECT appointment_type_id FROM staff_services WHERE staff_id = ?`;
        const rows = await this.execute<RowDataPacket[]>(sql, [staffId]);
        return rows.map(r => r.appointment_type_id as number);
    }

    /* -------------------------------- Helpers -------------------------------- */

    /** Leid een enkelvoudige 'is_active' vlag af uit availability (>=1 actieve dag) */
    private computeActiveFlag(availability?: { isActive: boolean }[] | null): number {
        if (!availability || availability.length === 0) return 0;
        return availability.some(a => a.isActive) ? 1 : 0;
    }
}

/** Backwards compat helper: sommige queries hebben geen updated_at alias. */
function r_updated_at(r: any): any {
    return r.updated_at ?? r.updatedAt ?? null;
}
