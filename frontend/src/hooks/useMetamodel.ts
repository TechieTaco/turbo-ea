import { useState, useEffect } from "react";
import { api } from "@/api/client";
import type { CardType, RelationType } from "@/types";

type Snapshot = { types: CardType[]; relationTypes: RelationType[] };

let _cache: Snapshot | null = null;
let _inflight: Promise<Snapshot> | null = null;

function _fetchOnce(): Promise<Snapshot> {
  if (_cache) return Promise.resolve(_cache);
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const [t, r] = await Promise.all([
      api.get<CardType[]>("/metamodel/types"),
      api.get<RelationType[]>("/metamodel/relation-types"),
    ]);
    _cache = { types: t, relationTypes: r };
    return _cache;
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function useMetamodel() {
  const [types, setTypes] = useState<CardType[]>(_cache?.types || []);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>(_cache?.relationTypes || []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) return;
    let cancelled = false;
    _fetchOnce()
      .then((snap) => {
        if (cancelled) return;
        setTypes(snap.types);
        setRelationTypes(snap.relationTypes);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const getType = (key: string) => types.find((t) => t.key === key);

  const getRelationsForType = (typeKey: string) =>
    relationTypes.filter(
      (r) => r.source_type_key === typeKey || r.target_type_key === typeKey
    );

  const invalidateCache = () => {
    _cache = null;
    _inflight = null;
  };

  return { types, relationTypes, loading, getType, getRelationsForType, invalidateCache };
}
