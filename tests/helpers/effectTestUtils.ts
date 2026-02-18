import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Micro } from "effect"

export const fromMicro = <A, E>(micro: Micro.Micro<A, E>) =>
	Effect.tryPromise({
		try: () => Micro.runPromise(micro),
		catch: (error) => {
			if (typeof error === "object" && error !== null && "_tag" in error && "error" in error) {
				if (error._tag === "Fail") {
					return error.error as E
				}
			}
			return error as E
		}
	})

export const withNodeFileSystem = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(Effect.provide(NodeFileSystem.layer))
