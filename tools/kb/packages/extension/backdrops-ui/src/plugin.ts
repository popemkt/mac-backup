import { Effect } from "effect";
import {
  GRADIENT_BACKDROP,
  SKY_BACKDROP,
  UNICORN_BACKDROP,
  backdropsExtension,
  backdropsPlugin,
} from "@kb/backdrops";
import { definePlugin } from "@kb/plugin";
import { BACKDROP_DIRECTIONS } from "@kb/model";
import { BackdropPoint, provideBackdrop, type Backdrop } from "@kb/ui-sdk";
import { SkyBackdrop } from "./sky/sky-backdrop";
import { GradientBackdrop } from "./tint-backdrop";
import { UnicornWashBackdrop } from "./unicorn-backdrop";
import "./backdrops.css";

/** The compact wash alone: no breathing room, and no direction. */
const gradient: Omit<Backdrop, "key"> = {
  presentation: {
    space: 0,
    directions: [],
    height: 160,
    maxWidth: 1120,
    offset: -40,
    opacity: { subtle: 0.5, soft: 0.75, vivid: 1 },
  },
  Component: GradientBackdrop,
};

/** The Unicorn Studio scene over the wash, in a taller frame that keeps its stars. */
const unicorn: Omit<Backdrop, "key"> = {
  presentation: {
    space: 160,
    directions: BACKDROP_DIRECTIONS,
    height: 500,
    maxWidth: 960,
    offset: -8,
    opacity: { subtle: 0.35, soft: 0.5, vivid: 0.75 },
  },
  Component: UnicornWashBackdrop,
};

/** The open sky: a canvas scene that feathers into the page on every side. */
const sky: Omit<Backdrop, "key"> = {
  presentation: {
    space: 120,
    directions: BACKDROP_DIRECTIONS,
    height: 360,
    maxWidth: 1040,
    offset: -10,
    opacity: { subtle: 0.6, soft: 0.82, vivid: 1 },
  },
  Component: SkyBackdrop,
};

/**
 * The backdrops family's page entry: kb's page-head backdrops, contributed
 * to `BackdropPoint` (the unicorn first, the one a head shows while no
 * choice is made), with the family's shared plugin as a child.
 */
export const backdropsUiPlugin = definePlugin({
  name: backdropsExtension.name,
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(backdropsPlugin()),
        ctx.contribute(BackdropPoint, provideBackdrop(UNICORN_BACKDROP, unicorn)),
        ctx.contribute(BackdropPoint, provideBackdrop(GRADIENT_BACKDROP, gradient)),
        ctx.contribute(BackdropPoint, provideBackdrop(SKY_BACKDROP, sky)),
      ],
      { discard: true },
    ),
});
