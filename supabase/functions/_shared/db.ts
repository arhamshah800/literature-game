import postgres from "npm:postgres@3.4.5";
import { requireEnv } from "./http.ts";

export type SqlClient = postgres.Sql;

export function createSqlClient(): SqlClient {
  return postgres(requireEnv("SUPABASE_DB_URL"), {
    max: 3,
    prepare: false
  });
}

export async function insertGameEvent(
  sql: SqlClient,
  input: {
    gameId: string;
    version: number;
    eventType: string;
    actorPlayerId: string | null;
    payload: unknown;
  }
): Promise<void> {
  await sql`
    insert into public.game_events (
      game_id,
      version,
      event_type,
      actor_player_id,
      payload
    )
    values (
      ${input.gameId},
      ${input.version},
      ${input.eventType},
      ${input.actorPlayerId},
      ${sql.json(input.payload)}
    )
  `;

  await sql`
    select realtime.send(
      jsonb_build_object(
        'gameId', ${input.gameId}::uuid,
        'version', ${input.version}::bigint,
        'event', ${input.eventType}::text,
        'payload', ${sql.json(input.payload)}::jsonb
      ),
      ${input.eventType}::text,
      'game:' || ${input.gameId}::uuid::text,
      true
    )
  `;
}

export async function logAction(
  sql: SqlClient,
  input: {
    gameId: string | null;
    userId: string;
    playerId: string | null;
    actionType: string;
    requestPayload: unknown;
    responsePayload?: unknown;
    requestId?: string | null;
    success: boolean;
    errorMessage?: string;
  }
): Promise<void> {
  await sql`
    insert into public.action_log (
      game_id,
      user_id,
      player_id,
      action_type,
      request_id,
      request_payload,
      response_payload,
      success,
      error_message
    )
    values (
      ${input.gameId},
      ${input.userId},
      ${input.playerId},
      ${input.actionType},
      ${input.requestId ?? null},
      ${sql.json(input.requestPayload)},
      ${input.responsePayload === undefined ? null : sql.json(input.responsePayload)},
      ${input.success},
      ${input.errorMessage ?? null}
    )
  `;
}
