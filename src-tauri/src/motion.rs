use std::collections::VecDeque;
use std::time::{Duration, Instant};

use serde::Serialize;

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

#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
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
    Standing { x: i32, y: i32 },
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
    Window { id: u64, left: f64, top: f64 },
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

#[derive(Clone, Copy, PartialEq, Debug)]
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
}

impl Motion {
    pub fn new(frame: Frame) -> Self {
        Self {
            phase: Phase::Unplaced,
            frame,
            foot_inset_ratio: 0.0,
            last_facing: Facing::Right,
        }
    }

    pub fn frame(&self) -> Frame {
        self.frame
    }

    pub fn needs_platforms(&self) -> bool {
        matches!(
            self.phase,
            Phase::Airborne { .. } | Phase::Standing(Support::Window { .. })
        )
    }

    pub fn event(&self) -> Option<MotionEvent> {
        match &self.phase {
            Phase::Unplaced => None,
            Phase::Dragging { facing, .. } => Some(MotionEvent::Dragging { facing: *facing }),
            Phase::Airborne { flying: Some(facing), .. } => {
                Some(MotionEvent::Flying { facing: *facing })
            }
            Phase::Airborne { flying: None, .. } => Some(MotionEvent::Falling),
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
        self.phase = match self.find_support(foot - SUPPORT_SNAP, foot + SUPPORT_SNAP, x, surroundings) {
            Some((support, top)) => {
                self.frame.y = top - foot_offset;
                Phase::Standing(support)
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
        match self.phase {
            Phase::Unplaced | Phase::Standing(Support::Floor) => {}
            Phase::Dragging { .. } => {
                if let Some((cursor_x, cursor_y)) = cursor {
                    self.follow_cursor(now, cursor_x, cursor_y);
                }
            }
            Phase::Airborne { .. } => self.fly(seconds, surroundings),
            Phase::Standing(Support::Window { id, left, top }) => {
                self.ride_window(id, left, top, surroundings)
            }
        }
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
                vx = vx.abs() * RESTITUTION;
                flying = flying.map(|_| Facing::Right);
            } else if x + self.frame.width > wall_right {
                x = wall_right - self.frame.width;
                vx = -vx.abs() * RESTITUTION;
                flying = flying.map(|_| Facing::Left);
            }
        }
        if y < display.bounds.top {
            y = display.bounds.top;
            vy = vy.abs() * RESTITUTION;
        }
        if let Some(facing) = flying {
            self.last_facing = facing;
        }

        let previous_foot = self.frame.y + foot_offset;
        self.frame.x = x;
        self.frame.y = y;
        if vy > 0.0 {
            if let Some((support, top)) = self.find_support(previous_foot, y + foot_offset, x, surroundings) {
                self.frame.y = top - foot_offset;
                self.phase = Phase::Standing(support);
                return;
            }
        }
        self.phase = Phase::Airborne { vx, vy, flying };
    }

    fn ride_window(&mut self, id: u64, left: f64, top: f64, surroundings: &Surroundings) {
        let Some(platform) = surroundings.platforms.iter().find(|platform| platform.id == id) else {
            self.phase = falling();
            return;
        };
        self.frame.x += platform.left - left;
        self.frame.y += platform.top - top;
        let (span_left, span_right) = self.foot_span(self.frame.x);
        if platform.left >= span_right || platform.right <= span_left {
            self.phase = falling();
            return;
        }
        self.phase = Phase::Standing(Support::Window {
            id,
            left: platform.left,
            top: platform.top,
        });
    }

    fn find_support(
        &self,
        previous_foot: f64,
        foot: f64,
        x: f64,
        surroundings: &Surroundings,
    ) -> Option<(Support, f64)> {
        let (span_left, span_right) = self.foot_span(x);
        let window_support = surroundings
            .platforms
            .iter()
            .filter(|platform| {
                platform.top > previous_foot
                    && platform.top <= foot
                    && platform.left < span_right
                    && platform.right > span_left
            })
            .min_by(|a, b| a.top.total_cmp(&b.top))
            .map(|platform| {
                (
                    Support::Window {
                        id: platform.id,
                        left: platform.left,
                        top: platform.top,
                    },
                    platform.top,
                )
            });
        let floor_support = surroundings
            .display_at((span_left + span_right) / 2.0, foot)
            .map(|display| display.work_area.bottom)
            .filter(|floor| foot >= *floor)
            .map(|floor| (Support::Floor, floor));
        match (window_support, floor_support) {
            (Some(window), Some(floor)) if floor.1 < window.1 => Some(floor),
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