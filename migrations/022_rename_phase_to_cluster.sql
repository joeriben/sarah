-- Rename Phase → Cluster (D/B: "clustering of cues")
ALTER TABLE phase_memberships RENAME TO cluster_memberships;
ALTER TABLE cluster_memberships RENAME COLUMN phase_id TO cluster_id;
ALTER INDEX idx_pm_phase RENAME TO idx_cm_cluster;
ALTER INDEX idx_pm_naming RENAME TO idx_cm_naming;
ALTER INDEX idx_pm_phase_seq RENAME TO idx_cm_cluster_seq;
