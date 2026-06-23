import { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { getTeamName } from "../game/display";
import { maxTeamNameLength, validateTeamNames } from "../game/teamNames";
import type { TeamIndex } from "../game/types";

type TeamNameEditorProps = {
  busy?: boolean;
  compact?: boolean;
  teamNames: Record<TeamIndex, string>;
  onSubmit: (teamNames: Record<TeamIndex, string>) => Promise<void> | void;
};

export function TeamNameEditor({ busy = false, compact = false, onSubmit, teamNames }: TeamNameEditorProps) {
  const [draft, setDraft] = useState<Record<TeamIndex, string>>({
    0: getTeamName(teamNames, 0),
    1: getTeamName(teamNames, 1)
  });
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft({
      0: getTeamName(teamNames, 0),
      1: getTeamName(teamNames, 1)
    });
    setError("");
  }, [teamNames]);

  const changed = useMemo(
    () => draft[0].trim() !== getTeamName(teamNames, 0) || draft[1].trim() !== getTeamName(teamNames, 1),
    [draft, teamNames]
  );

  async function save() {
    setError("");
    try {
      await onSubmit(validateTeamNames(draft));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save team names.");
    }
  }

  return (
    <div className={`team-name-editor ${compact ? "compact" : ""}`} data-collision-zone="team-name-editor">
      <div className="team-name-fields">
        {([0, 1] as const).map((teamIndex) => (
          <label key={teamIndex} className="team-name-field">
            <span>{teamIndex === 0 ? "Team 1" : "Team 2"}</span>
            <input
              className="control border-white/20 bg-white/10 text-white placeholder:text-white/45"
              maxLength={maxTeamNameLength}
              value={draft[teamIndex]}
              onChange={(event) => setDraft((current) => ({ ...current, [teamIndex]: event.target.value }))}
              placeholder={teamIndex === 0 ? "Team 1" : "Team 2"}
            />
          </label>
        ))}
      </div>
      <button className="primary-button team-name-save" disabled={busy || !changed} onClick={() => void save()} data-collision-check="team-name-save">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Save
      </button>
      {error ? <p className="team-name-error">{error}</p> : null}
    </div>
  );
}
