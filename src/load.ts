/**
 * long-black — ABR ABN Bulk Extract XML loader.
 *
 * Streaming SAX parse (saxes) of the `<Transfer>/<ABR>` records into staging
 * rows, composing each ABR's owned names + DGRs into arrays at parse time
 * (no child tables). Constant memory regardless of the ~6-8 GB extract: only
 * the current `<ABR>` is held.
 *
 * Verified against the real bulkextract.xsd:
 *   ABR ▸ ABN(@status,@ABNStatusFromDate) ▸ EntityType(Ind+Text)
 *       ▸ MainEntity(NonIndividualName[MN] + BusinessAddress)
 *         | LegalEntity(IndividualName[1-2 GivenName + FamilyName] + BusinessAddress)
 *       ▸ ASICNumber(@ASICNumberType)? ▸ GST(@status,@GSTStatusFromDate)?
 *       ▸ DGR(@DGRStatusFromDate,@status?, NonIndividualName?)* ▸ OtherEntity(NIN[TRD|BN|OTN])*
 */

import { createReadStream } from "node:fs";
import { once } from "node:events";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import postgres from "postgres";

export interface AbnDgrStaging {
  statusFromDate: string | null;
  status: string | null;
  name: string | null;
}

export interface AbnStagingRow {
  abn: string;
  abn_status: string | null;
  abn_status_from_date: string | null;
  entity_type_code: string | null;
  entity_type_text: string | null;
  entity_name: string | null;
  given_names: string | null;
  family_name: string | null;
  asic_number: string | null;
  asic_number_type: string | null;
  gst_status: string | null;
  gst_status_from_date: string | null;
  address_state: string | null;
  address_postcode: string | null;
  business_names: string[];
  trading_names: string[];
  other_names: string[];
  dgr: AbnDgrStaging[];
  record_last_updated: number | null;
}

/** ABR dates are YYYYMMDD; produce ISO "YYYY-MM-DD" (null if absent/malformed). */
function yyyymmddToIso(value: string | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function emptyToNull(value: string | null): string | null {
  if (value == null) return null;
  const s = value.trim();
  return s === "" ? null : s;
}

function newRow(): AbnStagingRow {
  return {
    abn: "",
    abn_status: null,
    abn_status_from_date: null,
    entity_type_code: null,
    entity_type_text: null,
    entity_name: null,
    given_names: null,
    family_name: null,
    asic_number: null,
    asic_number_type: null,
    gst_status: null,
    gst_status_from_date: null,
    address_state: null,
    address_postcode: null,
    business_names: [],
    trading_names: [],
    other_names: [],
    dgr: [],
    record_last_updated: null,
  };
}

/**
 * Push-based state machine over saxes. Feed chunks via write(); each completed
 * `<ABR>` invokes onRecord with a finished staging row.
 */
export class AbrParser {
  private readonly parser: SaxesParser;
  private row: AbnStagingRow | null = null;
  private text = "";
  private nameType: string | null = null; // current NonIndividualName/IndividualName @type
  private givenNames: string[] = [];
  private dgr: AbnDgrStaging | null = null;

  constructor(private readonly onRecord: (row: AbnStagingRow) => void) {
    this.parser = new SaxesParser();
    this.parser.on("opentag", (tag) => this.openTag(tag));
    this.parser.on("text", (t) => {
      this.text += t;
    });
    this.parser.on("closetag", (tag) => this.closeTag(tag));
  }

  write(chunk: string): void {
    this.parser.write(chunk);
  }

  close(): void {
    this.parser.close();
  }

  private openTag(tag: SaxesTagPlain): void {
    this.text = "";
    const a = tag.attributes;
    switch (tag.name) {
      case "ABR":
        this.row = newRow();
        this.row.record_last_updated = a.recordLastUpdatedDate
          ? Number(a.recordLastUpdatedDate)
          : null;
        break;
      case "ABN":
        if (this.row) {
          this.row.abn_status = emptyToNull(a.status ?? null);
          this.row.abn_status_from_date = yyyymmddToIso(a.ABNStatusFromDate);
        }
        break;
      case "NonIndividualName":
      case "IndividualName":
        this.nameType = a.type ?? null;
        if (tag.name === "IndividualName") this.givenNames = [];
        break;
      case "ASICNumber":
        if (this.row) this.row.asic_number_type = emptyToNull(a.ASICNumberType ?? null);
        break;
      case "GST":
        if (this.row) {
          this.row.gst_status = emptyToNull(a.status ?? null);
          this.row.gst_status_from_date = yyyymmddToIso(a.GSTStatusFromDate);
        }
        break;
      case "DGR":
        this.dgr = {
          statusFromDate: yyyymmddToIso(a.DGRStatusFromDate),
          status: emptyToNull(a.status ?? null),
          name: null,
        };
        break;
      default:
        break;
    }
  }

  private closeTag(tag: SaxesTagPlain): void {
    const value = this.text.trim();
    const row = this.row;
    switch (tag.name) {
      case "ABR":
        if (row) this.onRecord(row);
        this.row = null;
        break;
      case "ABN":
        if (row) row.abn = value;
        break;
      case "EntityTypeInd":
        if (row) row.entity_type_code = emptyToNull(value);
        break;
      case "EntityTypeText":
        if (row) row.entity_type_text = emptyToNull(value);
        break;
      case "ASICNumber":
        if (row) row.asic_number = emptyToNull(value);
        break;
      case "GivenName":
        if (value) this.givenNames.push(value);
        break;
      case "FamilyName":
        if (row) row.family_name = emptyToNull(value);
        break;
      case "IndividualName":
        if (row) row.given_names = this.givenNames.length ? this.givenNames.join(" ") : null;
        this.nameType = null;
        break;
      case "NonIndividualNameText":
        this.routeName(value);
        break;
      case "NonIndividualName":
        this.nameType = null;
        break;
      case "DGR":
        if (row && this.dgr) row.dgr.push(this.dgr);
        this.dgr = null;
        break;
      case "State":
        if (row) row.address_state = value; // may legitimately be "" (kept; doc-side coerces)
        break;
      case "Postcode":
        if (row) row.address_postcode = emptyToNull(value);
        break;
      default:
        break;
    }
    this.text = "";
  }

  private routeName(value: string): void {
    const row = this.row;
    if (!row) return;
    if (this.dgr) {
      this.dgr.name = emptyToNull(value);
      return;
    }
    switch (this.nameType) {
      case "MN":
        row.entity_name = emptyToNull(value);
        break;
      case "BN":
        if (value) row.business_names.push(value);
        break;
      case "TRD":
        if (value) row.trading_names.push(value);
        break;
      case "OTN":
        if (value) row.other_names.push(value);
        break;
      default:
        break;
    }
  }
}

/** Parse a complete XML string into staging rows (used by tests + small loads). */
export function parseAbrXmlString(xml: string): AbnStagingRow[] {
  const rows: AbnStagingRow[] = [];
  const parser = new AbrParser((r) => rows.push(r));
  parser.write(xml);
  parser.close();
  return rows;
}

// --- COPY loader (production path; validated end-to-end at small scale) ---

const COPY_COLUMNS = [
  "abn",
  "abn_status",
  "abn_status_from_date",
  "entity_type_code",
  "entity_type_text",
  "entity_name",
  "given_names",
  "family_name",
  "asic_number",
  "asic_number_type",
  "gst_status",
  "gst_status_from_date",
  "address_state",
  "address_postcode",
  "business_names",
  "trading_names",
  "other_names",
  "dgr",
  "record_last_updated",
] as const;

/** CSV-quote a single COPY field (NULL is empty + unquoted via FORMAT csv NULL ''). */
function csvField(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  if (s === "") return '""'; // empty string, distinct from NULL
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToCsvLine(row: AbnStagingRow): string {
  const fields: (string | number | null)[] = [
    row.abn,
    row.abn_status,
    row.abn_status_from_date,
    row.entity_type_code,
    row.entity_type_text,
    row.entity_name,
    row.given_names,
    row.family_name,
    row.asic_number,
    row.asic_number_type,
    row.gst_status,
    row.gst_status_from_date,
    row.address_state,
    row.address_postcode,
    JSON.stringify(row.business_names),
    JSON.stringify(row.trading_names),
    JSON.stringify(row.other_names),
    JSON.stringify(row.dgr),
    row.record_last_updated,
  ];
  return fields.map(csvField).join(",") + "\n";
}

export interface LoadAbnOptions {
  connectionString: string;
  schemaVersion: string;
  /** Extracted ABR *.xml file paths. */
  files: string[];
}

/**
 * Stream ABR XML files into the unconstrained `abn` staging table via a single
 * COPY (one connection — sidesteps postgres@3's COPY_IN_PROGRESS rule). Run
 * abn-finalize.sql afterwards to add the PK.
 */
export async function loadAbnFiles(options: LoadAbnOptions): Promise<{ count: number }> {
  const { connectionString, schemaVersion, files } = options;
  const sql = postgres(connectionString, { max: 1, max_lifetime: null });
  let count = 0;
  try {
    const reserved = await sql.reserve();
    try {
      const table = `abn_${schemaVersion}.abn`;
      const copy = `COPY ${table} (${COPY_COLUMNS.join(",")}) FROM STDIN WITH (FORMAT csv, NULL '')`;
      // reserved.unsafe(...).writable() — COPY stream, no cursor needed.
      const writable = await reserved.unsafe(copy).writable();

      for (const file of files) {
        const input = createReadStream(file, { encoding: "utf-8" });
        const parser = new AbrParser((row) => {
          count++;
          // backpressure: pause the file stream until the COPY buffer drains
          if (!writable.write(rowToCsvLine(row))) input.pause();
        });
        const onDrain = (): void => {
          input.resume();
        };
        writable.on("drain", onDrain);
        input.on("data", (chunk) => parser.write(String(chunk)));
        await once(input, "end");
        parser.close();
        writable.off("drain", onDrain);
      }

      writable.end();
      await once(writable, "finish");
      return { count };
    } finally {
      reserved.release();
    }
  } finally {
    await sql.end();
  }
}
