use std::collections::VecDeque;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::platforms::PlatformRect;

pub const CELL_WIDTH: f64 = 192.0;
pub const CELL_HEIGHT: f64 = 208.0;
const GRAVITY: f64 = 2400.0;
const RESTITUTION: f64 = 0.25;
const THROW_MIN_SPEED: f64 = 600.0;
const THROW_MAX_SPEED: f64 = 2400.0;
const THROW_VELOCITY_RATIO: f64 = 0.45;
const THROW_ACCELERATION_SECONDS: f64 = 0.05;
const AIR_DRAG: f64 = 1.2;
const RELEASE_SAMPLE_WINDOW: Duration = Duration::from_millis(80);
const DRAG_FACING_THRESHOLD: f64 = 0.5;
const FOOT_SPAN_RATIO: f64 = 0.25;
const SUPPORT_SNAP: f64 = 2.0;
const MAX_STEP_SECONDS: f64 = 0.05;
const WINDOW_VELOCITY_SMOOTHING_SECONDS: f64 = 0.04;
const WINDOW_HIT_MIN_SPEED: f64 = 120.0;
const WALK_SPEED: f64 = 80.0;
const LEAP_SPEED_X: f64 = 240.0;
const LEAP_SPEED_Y: f64 = 700.0;
const IMPACT_MIN_SPEED: f64 = 300.0;
const IMPACT_FULL_SPEED: f64 = 2400.0;

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Facing {
    Left,
    Right,
}

#[derive(Clone, PartialEq, Debug, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum MotionEvent {
    Dragging { facing: Facing },
    Falling,
    Flying { facing: Facing },
    Walking { facing: Facing },
    Standing { x: i32, y: i32 },
}

impl Facing {
    fn sign(self) -> f64 {
        match self {
            Facing::Left => -1.0,
            Facing::Right => 1.0,
        }
    }

    fn opposite(self) -> Facing {
        match self {
            Facing::Left => Facing::Right,
            Facing::Right => Facing::Left,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Walk {
    facing: Facing,
    speed: f64,
    remaining: f64,
    leap: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct WalkSnapshot {
    pub remaining: f64,
    pub leap: bool,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SupportSnapshot {
    Floor,
    Window { id: u64 },
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct MotionSnapshot {
    pub state: &'static str,
    pub facing: Option<Facing>,
    pub vx: f64,
    pub vy: f64,
    pub support: Option<SupportSnapshot>,
    pub walk: Option<WalkSnapshot>,
    pub frame: Frame,
    pub foot: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Area {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl Area {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }

    fn distance_to(&self, x: f64, y: f64) -> f64 {
        let dx = (self.left - x).max(x - self.right).max(0.0);
        let dy = (self.top - y).max(y - self.bottom).max(0.0);
        dx.hypot(dy)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Display {
    pub bounds: Area,
    pub work_area: Area,
    pub scale: f64,
    pub primary: bool,
}

pub struct Surroundings {
    pub displays: Vec<Display>,
    pub platforms: Vec<PlatformRect>,
}

impl Surroundings {
    pub fn display_at(&self, x: f64, y: f64) -> Option<&Display> {
        self.displays
            .iter()
            .find(|display| display.bounds.contains(x, y))
            .or_else(|| {
                self.displays.iter().min_by(|a, b| {
                    a.bounds.distance_to(x, y).total_cmp(&b.bounds.distance_to(x, y))
                })
            })
    }

    fn horizontal_extent(&self) -> Option<(f64, f64)> {
        let left = self.displays.iter().map(|display| display.bounds.left).reduce(f64::min)?;
        let right = self.displays.iter().map(|display| display.bounds.right).reduce(f64::max)?;
        Some((left, right))
    }

    fn primary_work_area(&self) -> Option<Area> {
        self.displays
            .iter()
            .find(|display| display.primary)
            .or(self.displays.first())
            .map(|display| display.work_area)
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        self.displays.iter().any(|display| display.bounds.contains(x, y))
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Support {
    Floor,
    Window { id: u64, vy: f64 },
}

#[derive(Clone, Debug)]
struct TrackedPlatform {
    rect: PlatformRect,
    previous_left: f64,
    previous_right: f64,
    previous_top: f64,
    vx: f64,
    vy: f64,
    visible_top: Vec<(f64, f64)>,
}

impl TrackedPlatform {
    fn visible_under(&self, span_left: f64, span_right: f64) -> Option<(f64, f64)> {
        self.visible_top
            .iter()
            .copied()
            .filter(|(left, right)| *left < span_right && *right > span_left)
            .max_by(|a, b| overlap(*a, span_left, span_right).total_cmp(&overlap(*b, span_left, span_right)))
    }

    fn push_offset(&self, span_left: f64, span_right: f64) -> Option<f64> {
        if self.rect.left >= span_right || self.rect.right <= span_left {
            None
        } else if self.previous_left >= span_right {
            Some(self.rect.left - span_right)
        } else if self.previous_right <= span_left {
            Some(self.rect.right - span_left)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImpactSide {
    Left,
    Right,
    Top,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Impact {
    pub side: ImpactSide,
    pub strength: f64,
}

#[derive(Clone, Copy, Debug)]
struct Contact {
    support: Support,
    top: f64,
    vy: f64,
}

enum Phase {
    Unplaced,
    Dragging {
        grab_x: f64,
        grab_y: f64,
        samples: VecDeque<(Instant, f64, f64)>,
        facing: Facing,
    },
    Airborne {
        vx: f64,
        vy: f64,
        flying: Option<Facing>,
    },
    Standing(Support),
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct Motion {
    phase: Phase,
    frame: Frame,
    foot_inset_ratio: f64,
    last_facing: Facing,
    platforms: Vec<TrackedPlatform>,
    walk: Option<Walk>,
    impact: Option<Impact>,
}

impl Motion {
    pub fn new(frame: Frame) -> Self {
        Self {
            phase: Phase::Unplaced,
            frame,
            foot_inset_ratio: 0.0,
            last_facing: Facing::Right,
            platforms: Vec::new(),
            walk: None,
            impact: None,
        }
    }

    pub fn frame(&self) -> Frame {
        self.frame
    }

    pub fn take_impact(&mut self) -> Option<Impact> {
        self.impact.take()
    }

    pub fn needs_platforms(&self) -> bool {
        matches!(
            self.phase,
            Phase::Airborne { .. } | Phase::Standing(Support::Window { .. })
        )
    }

    pub fn snapshot(&self) -> MotionSnapshot {
        let carried = match self.phase {
            Phase::Standing(Support::Window { id, .. }) => self
                .platforms
                .iter()
                .find(|tracked| tracked.rect.id == id)
                .map_or((0.0, 0.0), |tracked| (tracked.vx, tracked.vy)),
            _ => (0.0, 0.0),
        };
        let (state, facing, (vx, vy)) = match &self.phase {
            Phase::Unplaced => ("unplaced", None, (0.0, 0.0)),
            Phase::Dragging { samples, facing, .. } => ("dragging", Some(*facing), average_velocity(samples)),
            Phase::Airborne { vx, vy, flying: Some(facing) } => ("flying", Some(*facing), (*vx, *vy)),
            Phase::Airborne { vx, vy, flying: None } => ("falling", None, (*vx, *vy)),
            Phase::Standing(_) => match self.walk {
                Some(walk) => ("walking", Some(walk.facing), (carried.0 + walk.facing.sign() * walk.speed, carried.1)),
                None => ("standing", None, carried),
            },
        };
        let support = match self.phase {
            Phase::Standing(Support::Floor) => Some(SupportSnapshot::Floor),
            Phase::Standing(Support::Window { id, .. }) => Some(SupportSnapshot::Window { id }),
            _ => None,
        };
        MotionSnapshot {
            state,
            facing,
            vx,
            vy,
            support,
            walk: self.walk.map(|walk| WalkSnapshot {
                remaining: walk.remaining,
                leap: walk.leap,
            }),
            frame: self.frame,
            foot: self.frame.y + self.foot_offset(),
        }
    }

    pub fn event(&self) -> Option<MotionEvent> {
        match &self.phase {
            Phase::Unplaced => None,
            Phase::Dragging { facing, .. } => Some(MotionEvent::Dragging { facing: *facing }),
            Phase::Airborne { flying: Some(facing), .. } => {
                Some(MotionEvent::Flying { facing: *facing })
            }
            Phase::Airborne { flying: None, .. } => Some(MotionEvent::Falling),
            Phase::Standing(_) if self.walk.is_some() => Some(MotionEvent::Walking {
                facing: self.walk.map_or(self.last_facing, |walk| walk.facing),
            }),
            Phase::Standing(_) => Some(MotionEvent::Standing {
                x: self.frame.x.round() as i32,
                y: self.frame.y.round() as i32,
            }),
        }
    }

    pub fn place(&mut self, saved: Option<(f64, f64)>, surroundings: &Surroundings) {
        let frame = self.frame;
        let foot_offset = self.foot_offset();
        let restored = saved.filter(|(x, y)| {
            surroundings.contains(x + frame.width / 2.0, y + frame.height / 2.0)
        });
        let (x, y) = match (restored, surroundings.primary_work_area()) {
            (Some(position), _) => position,
            (None, Some(work_area)) => (
                work_area.left + (work_area.right - work_area.left - frame.width) / 2.0,
                work_area.bottom - foot_offset,
            ),
            (None, None) => (frame.x, frame.y),
        };
        self.frame.x = x;
        self.frame.y = y;
        let foot = y + foot_offset;
        self.track_platforms(0.0, &surroundings.platforms);
        self.phase = match self.find_support(foot - SUPPORT_SNAP, foot + SUPPORT_SNAP, x, surroundings) {
            Some(contact) => {
                self.frame.y = contact.top - foot_offset;
                Phase::Standing(contact.support)
            }
            None => falling(),
        };
    }

    pub fn set_foot_inset_ratio(&mut self, ratio: f64) {
        let foot = self.frame.y + self.foot_offset();
        self.foot_inset_ratio = ratio;
        self.frame.y = foot - self.foot_offset();
    }

    pub fn resize(&mut self, scale: f64, display_scale: f64) {
        let center = self.frame.x + self.frame.width / 2.0;
        let bottom = self.frame.y + self.frame.height;
        let width = (CELL_WIDTH * scale * display_scale).round();
        let height = (CELL_HEIGHT * scale * display_scale).round();
        self.frame = Frame {
            x: center - width / 2.0,
            y: bottom - height,
            width,
            height,
        };
    }

    pub fn start_walk(&mut self, facing: Facing, distance: f64, leap: bool, display_scale: f64) {
        if !matches!(self.phase, Phase::Standing(_)) {
            return;
        }
        self.last_facing = facing;
        self.walk = Some(Walk {
            facing,
            speed: WALK_SPEED * display_scale,
            remaining: distance * display_scale,
            leap,
        });
    }

    pub fn stop_walk(&mut self) {
        self.walk = None;
    }

    pub fn start_drag(&mut self, cursor_x: f64, cursor_y: f64) {
        self.phase = Phase::Dragging {
            grab_x: cursor_x - self.frame.x,
            grab_y: cursor_y - self.frame.y,
            samples: VecDeque::new(),
            facing: self.last_facing,
        };
    }

    pub fn release(&mut self, display_scale: f64) {
        let Phase::Dragging { samples, facing, .. } = &self.phase else {
            return;
        };
        let (vx, vy) = average_velocity(samples);
        let acceleration = forward_acceleration(samples, vx, vy);
        let facing = *facing;
        self.phase = if vx.hypot(vy) >= THROW_MIN_SPEED * display_scale {
            let (vx, vy) = throw_velocity(vx, vy, acceleration, THROW_MAX_SPEED * display_scale);
            let throw_facing = if vx > 0.0 {
                Facing::Right
            } else if vx < 0.0 {
                Facing::Left
            } else {
                facing
            };
            self.last_facing = throw_facing;
            Phase::Airborne {
                vx,
                vy,
                flying: Some(throw_facing),
            }
        } else {
            falling()
        };
    }

    pub fn step(
        &mut self,
        elapsed: Duration,
        now: Instant,
        cursor: Option<(f64, f64)>,
        surroundings: &Surroundings,
    ) {
        let seconds = elapsed.as_secs_f64().min(MAX_STEP_SECONDS);
        self.track_platforms(seconds, &surroundings.platforms);
        match self.phase {
            Phase::Unplaced | Phase::Standing(Support::Floor) => {}
            Phase::Dragging { .. } => {
                if let Some((cursor_x, cursor_y)) = cursor {
                    self.follow_cursor(now, cursor_x, cursor_y);
                }
            }
            Phase::Airborne { .. } => self.fly(seconds, surroundings),
            Phase::Standing(Support::Window { id, vy }) => {
                self.ride_window(id, vy, seconds, surroundings)
            }
        }
        if matches!(self.phase, Phase::Standing(_)) {
            self.advance_walk(seconds, surroundings);
        } else {
            self.walk = None;
        }
    }

    fn advance_walk(&mut self, seconds: f64, surroundings: &Surroundings) {
        let Some(mut walk) = self.walk else {
            return;
        };
        let Some((surface_left, surface_right, leap_left, leap_right)) = self.walking_surface(surroundings) else {
            self.walk = None;
            return;
        };
        let (span_left, span_right) = self.foot_span(self.frame.x);
        let step = (walk.speed * seconds).min(walk.remaining);
        let (reaches_edge, leapable) = match walk.facing {
            Facing::Right => (span_right + step > surface_right, leap_right),
            Facing::Left => (span_left - step < surface_left, leap_left),
        };
        walk.remaining -= step;
        if !reaches_edge {
            self.frame.x += walk.facing.sign() * step;
        } else if walk.leap && leapable {
            self.leap(walk.facing, surroundings);
            return;
        } else {
            walk.facing = walk.facing.opposite();
            walk.leap = false;
            self.last_facing = walk.facing;
        }
        self.walk = (walk.remaining > 0.0).then_some(walk);
    }

    fn walking_surface(&self, surroundings: &Surroundings) -> Option<(f64, f64, bool, bool)> {
        let (screen_left, screen_right) = surroundings.horizontal_extent()?;
        match self.phase {
            Phase::Standing(Support::Floor) => {
                let display = surroundings.display_at(self.frame.x + self.frame.width / 2.0, self.frame.y + self.foot_offset())?;
                Some((display.work_area.left, display.work_area.right, false, false))
            }
            Phase::Standing(Support::Window { id, .. }) => {
                let platform = self.platforms.iter().find(|tracked| tracked.rect.id == id)?;
                let (span_left, span_right) = self.foot_span(self.frame.x);
                let (left, right) = platform.visible_under(span_left, span_right)?;
                Some((
                    left.max(screen_left),
                    right.min(screen_right),
                    left == platform.rect.left && left > screen_left,
                    right == platform.rect.right && right < screen_right,
                ))
            }
            _ => None,
        }
    }

    fn leap(&mut self, facing: Facing, surroundings: &Surroundings) {
        let scale = surroundings
            .display_at(self.frame.x + self.frame.width / 2.0, self.frame.y + self.foot_offset())
            .map_or(1.0, |display| display.scale);
        let carried_vx = match self.phase {
            Phase::Standing(Support::Window { id, .. }) => self
                .platforms
                .iter()
                .find(|tracked| tracked.rect.id == id)
                .map_or(0.0, |tracked| tracked.vx),
            _ => 0.0,
        };
        self.walk = None;
        self.last_facing = facing;
        self.phase = Phase::Airborne {
            vx: carried_vx + facing.sign() * LEAP_SPEED_X * scale,
            vy: -LEAP_SPEED_Y * scale,
            flying: None,
        };
    }

    fn follow_cursor(&mut self, now: Instant, cursor_x: f64, cursor_y: f64) {
        let Phase::Dragging {
            grab_x,
            grab_y,
            samples,
            facing,
        } = &mut self.phase
        else {
            return;
        };
        let x = cursor_x - *grab_x;
        let y = cursor_y - *grab_y;
        let dx = x - self.frame.x;
        if dx > DRAG_FACING_THRESHOLD {
            *facing = Facing::Right;
        } else if dx < -DRAG_FACING_THRESHOLD {
            *facing = Facing::Left;
        }
        self.last_facing = *facing;
        samples.push_back((now, x, y));
        while samples
            .front()
            .is_some_and(|(at, _, _)| now.duration_since(*at) > RELEASE_SAMPLE_WINDOW)
        {
            samples.pop_front();
        }
        self.frame.x = x;
        self.frame.y = y;
    }

    fn fly(&mut self, seconds: f64, surroundings: &Surroundings) {
        let Phase::Airborne { mut vx, mut vy, mut flying } = self.phase else {
            return;
        };
        let foot_offset = self.foot_offset();
        let center_x = self.frame.x + self.frame.width / 2.0;
        let Some(display) = surroundings.display_at(center_x, self.frame.y + foot_offset).copied() else {
            return;
        };
        vy += GRAVITY * display.scale * seconds;
        vx *= (-AIR_DRAG * seconds).exp();
        let mut x = self.frame.x + vx * seconds;
        let mut y = self.frame.y + vy * seconds;

        if let Some((wall_left, wall_right)) = surroundings.horizontal_extent() {
            if x < wall_left {
                x = wall_left;
                self.record_impact(ImpactSide::Left, vx.abs(), display.scale);
                vx = vx.abs() * RESTITUTION;
                flying = flying.map(|_| Facing::Right);
            } else if x + self.frame.width > wall_right {
                x = wall_right - self.frame.width;
                self.record_impact(ImpactSide::Right, vx.abs(), display.scale);
                vx = -vx.abs() * RESTITUTION;
                flying = flying.map(|_| Facing::Left);
            }
        }
        if y < display.bounds.top {
            y = display.bounds.top;
            self.record_impact(ImpactSide::Top, vy.abs(), display.scale);
            vy = vy.abs() * RESTITUTION;
        }
        if let Some(facing) = flying {
            self.last_facing = facing;
        }

        let previous_foot = self.frame.y + foot_offset;
        self.frame.x = x;
        self.frame.y = y;
        if let Some(contact) = self.find_support(previous_foot, y + foot_offset, x, surroundings) {
            self.frame.y = contact.top - foot_offset;
            if contact.vy < -WINDOW_HIT_MIN_SPEED * display.scale {
                vy = contact.vy - (vy - contact.vy).max(0.0) * RESTITUTION;
            } else {
                self.phase = Phase::Standing(match contact.support {
                    Support::Window { id, .. } => Support::Window { id, vy: contact.vy },
                    Support::Floor => Support::Floor,
                });
                return;
            }
        }
        self.phase = Phase::Airborne { vx, vy, flying };
    }

    fn ride_window(&mut self, id: u64, vy: f64, seconds: f64, surroundings: &Surroundings) {
        let Some(platform) = self.platforms.iter().find(|tracked| tracked.rect.id == id).cloned() else {
            self.phase = Phase::Airborne { vx: 0.0, vy, flying: None };
            return;
        };
        let foot_offset = self.foot_offset();
        let scale = surroundings
            .display_at(self.frame.x + self.frame.width / 2.0, self.frame.y + foot_offset)
            .map_or(1.0, |display| display.scale);
        let vy = vy + GRAVITY * scale * seconds;
        self.frame.x += platform.rect.left - platform.previous_left;
        let previous_foot = self.frame.y + foot_offset;
        let foot = previous_foot + vy * seconds;
        let rising = self
            .window_contact(previous_foot - SUPPORT_SNAP * scale, platform.rect.top, self.frame.x, Some(id))
            .filter(|contact| contact.top < platform.rect.top);
        if let Some(contact) = rising {
            self.frame.y = contact.top - foot_offset;
            self.phase = if contact.vy < -WINDOW_HIT_MIN_SPEED * scale {
                Phase::Airborne {
                    vx: platform.vx,
                    vy: contact.vy - (vy - contact.vy).max(0.0) * RESTITUTION,
                    flying: None,
                }
            } else {
                Phase::Standing(contact.support)
            };
            return;
        }
        self.frame.x += self.push_offset(id, previous_foot);
        if let Some((screen_left, screen_right)) = surroundings.horizontal_extent() {
            self.frame.x = self.frame.x.clamp(screen_left, screen_right - self.frame.width);
        }
        let (span_left, span_right) = self.foot_span(self.frame.x);
        let visible = platform.visible_under(span_left, span_right).is_some();
        if !visible || foot < platform.rect.top - SUPPORT_SNAP * scale {
            self.frame.y = foot - foot_offset;
            self.phase = Phase::Airborne { vx: platform.vx, vy, flying: None };
            return;
        }
        self.frame.y = platform.rect.top - foot_offset;
        self.phase = Phase::Standing(Support::Window { id, vy: platform.vy });
    }

    fn push_offset(&self, support_id: u64, foot: f64) -> f64 {
        let (span_left, span_right) = self.foot_span(self.frame.x);
        self.platforms
            .iter()
            .filter(|platform| platform.rect.id != support_id && platform.rect.top < foot && platform.rect.bottom > foot)
            .find_map(|platform| platform.push_offset(span_left, span_right))
            .unwrap_or(0.0)
    }

    fn record_impact(&mut self, side: ImpactSide, speed: f64, display_scale: f64) {
        if speed < IMPACT_MIN_SPEED * display_scale {
            return;
        }
        self.impact = Some(Impact {
            side,
            strength: (speed / display_scale / IMPACT_FULL_SPEED).min(1.0),
        });
    }

    fn track_platforms(&mut self, seconds: f64, platforms: &[PlatformRect]) {
        let blend = 1.0 - (-seconds / WINDOW_VELOCITY_SMOOTHING_SECONDS).exp();
        self.platforms = platforms
            .iter()
            .enumerate()
            .map(|(index, rect)| {
                let visible_top = visible_top(rect, &platforms[..index]);
                match self.platforms.iter().find(|tracked| tracked.rect.id == rect.id) {
                    Some(previous) if seconds > 0.0 => TrackedPlatform {
                        rect: *rect,
                        previous_left: previous.rect.left,
                        previous_right: previous.rect.right,
                        previous_top: previous.rect.top,
                        vx: previous.vx + ((rect.left - previous.rect.left) / seconds - previous.vx) * blend,
                        vy: previous.vy + ((rect.top - previous.rect.top) / seconds - previous.vy) * blend,
                        visible_top,
                    },
                    _ => TrackedPlatform {
                        rect: *rect,
                        previous_left: rect.left,
                        previous_right: rect.right,
                        previous_top: rect.top,
                        vx: 0.0,
                        vy: 0.0,
                        visible_top,
                    },
                }
            })
            .collect();
    }

    fn window_contact(&self, previous_foot: f64, foot: f64, x: f64, except: Option<u64>) -> Option<Contact> {
        let (span_left, span_right) = self.foot_span(x);
        self.platforms
            .iter()
            .filter(|platform| {
                Some(platform.rect.id) != except
                    && platform.previous_top >= previous_foot
                    && platform.rect.top <= foot
                    && platform.visible_under(span_left, span_right).is_some()
            })
            .min_by(|a, b| a.rect.top.total_cmp(&b.rect.top))
            .map(window_contact_of)
    }

    fn find_support(
        &self,
        previous_foot: f64,
        foot: f64,
        x: f64,
        surroundings: &Surroundings,
    ) -> Option<Contact> {
        let (span_left, span_right) = self.foot_span(x);
        let window_support = self.window_contact(previous_foot, foot, x, None);
        let floor_support = surroundings
            .display_at((span_left + span_right) / 2.0, foot)
            .map(|display| display.work_area.bottom)
            .filter(|floor| foot >= *floor)
            .map(|floor| Contact {
                support: Support::Floor,
                top: floor,
                vy: 0.0,
            });
        match (window_support, floor_support) {
            (Some(window), Some(floor)) if floor.top < window.top => Some(floor),
            (Some(window), _) => Some(window),
            (None, floor) => floor,
        }
    }

    fn foot_span(&self, x: f64) -> (f64, f64) {
        let center = x + self.frame.width / 2.0;
        let half = self.frame.width * FOOT_SPAN_RATIO;
        (center - half, center + half)
    }

    fn foot_offset(&self) -> f64 {
        self.frame.height * (1.0 - self.foot_inset_ratio)
    }
}

fn window_contact_of(platform: &TrackedPlatform) -> Contact {
    Contact {
        support: Support::Window {
            id: platform.rect.id,
            vy: platform.vy,
        },
        top: platform.rect.top,
        vy: platform.vy,
    }
}

fn visible_top(rect: &PlatformRect, front: &[PlatformRect]) -> Vec<(f64, f64)> {
    front
        .iter()
        .filter(|cover| cover.top < rect.top && cover.bottom > rect.top)
        .fold(vec![(rect.left, rect.right)], |visible, cover| {
            visible
                .into_iter()
                .flat_map(|(left, right)| [(left, right.min(cover.left)), (left.max(cover.right), right)])
                .filter(|(left, right)| right > left)
                .collect()
        })
}

fn overlap((left, right): (f64, f64), span_left: f64, span_right: f64) -> f64 {
    right.min(span_right) - left.max(span_left)
}

fn falling() -> Phase {
    Phase::Airborne {
        vx: 0.0,
        vy: 0.0,
        flying: None,
    }
}

fn average_velocity(samples: &VecDeque<(Instant, f64, f64)>) -> (f64, f64) {
    let (Some(first), Some(last)) = (samples.front(), samples.back()) else {
        return (0.0, 0.0);
    };
    velocity_between(first, last)
}

fn velocity_between(from: &(Instant, f64, f64), to: &(Instant, f64, f64)) -> (f64, f64) {
    let seconds = to.0.duration_since(from.0).as_secs_f64();
    if seconds <= 0.0 {
        return (0.0, 0.0);
    }
    ((to.1 - from.1) / seconds, (to.2 - from.2) / seconds)
}

fn forward_acceleration(samples: &VecDeque<(Instant, f64, f64)>, vx: f64, vy: f64) -> f64 {
    let speed = vx.hypot(vy);
    let (Some(first), Some(last)) = (samples.front(), samples.back()) else {
        return 0.0;
    };
    let middle_index = samples.len() / 2;
    let middle = &samples[middle_index];
    let seconds = last.0.duration_since(first.0).as_secs_f64();
    if speed <= 0.0 || seconds <= 0.0 || middle_index == 0 || middle_index == samples.len() - 1 {
        return 0.0;
    }
    let (early_x, early_y) = velocity_between(first, middle);
    let (late_x, late_y) = velocity_between(middle, last);
    let along = ((late_x - early_x) * vx + (late_y - early_y) * vy) / speed;
    (along / (seconds / 2.0)).max(0.0)
}

fn throw_velocity(vx: f64, vy: f64, acceleration: f64, max_speed: f64) -> (f64, f64) {
    let hand_speed = vx.hypot(vy);
    let boosted = hand_speed + acceleration * THROW_ACCELERATION_SECONDS;
    let flight_speed = max_speed * (boosted * THROW_VELOCITY_RATIO / max_speed).tanh();
    (vx / hand_speed * flight_speed, vy / hand_speed * flight_speed)
}
