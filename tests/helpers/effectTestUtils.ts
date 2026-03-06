import { NodeFileSystem } from "@effect/platform-node"
import { Effect } from "effect"

export const withNodeFileSystem = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(Effect.provide(NodeFileSystem.layer))
