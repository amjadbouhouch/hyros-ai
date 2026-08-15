import { CURRENT_USER_ID, type Chat } from "./types.js";

const minutesAgo = (minutes: number): Date =>
  new Date(Date.now() - minutes * 60_000);
const hoursAgo = (hours: number): Date => minutesAgo(hours * 60);
const daysAgo = (days: number): Date => hoursAgo(days * 24);

/**
 * Mock user-to-user conversations — replaced by real data once messaging is
 * wired to the gateway.
 */
export const MOCK_CHATS: Chat[] = [
  {
    id: 1,
    name: "James Johnson",
    email: "james.johnson@hyros.ai",
    role: "Product Engineer",
    status: "online",
    messages: [
      {
        id: 1,
        senderId: CURRENT_USER_ID,
        text: "Morning James — got a sec to look at the service task spec?",
        createdAt: hoursAgo(28),
      },
      {
        id: 2,
        senderId: 1,
        text: "Morning! Yeah, give me ten to finish this PR review.",
        createdAt: hoursAgo(27.8),
      },
      {
        id: 3,
        senderId: 1,
        text: "Okay, looking at it now. Scope feels bigger than we estimated.",
        createdAt: hoursAgo(27.5),
      },
      {
        id: 4,
        senderId: CURRENT_USER_ID,
        text: "Which part? The PDF generation?",
        createdAt: hoursAgo(27.4),
      },
      {
        id: 5,
        senderId: 1,
        text: "Yeah. The template engine doesn't handle nested tables well.",
        createdAt: hoursAgo(27.2),
      },
      {
        id: 6,
        senderId: 1,
        text: "I can work around it with a flatter structure though.",
        createdAt: hoursAgo(27.1),
      },
      {
        id: 7,
        senderId: CURRENT_USER_ID,
        text: "Let's do that. Design signed off on the new homepage too, by the way.",
        createdAt: hoursAgo(26.8),
      },
      {
        id: 8,
        senderId: 1,
        text: "Nice — send me the fig when you have it.",
        createdAt: hoursAgo(26.6),
      },
      {
        id: 9,
        senderId: CURRENT_USER_ID,
        text: "Will do. Also, QA flagged the auth redirect loop on staging again.",
        createdAt: hoursAgo(26.5),
      },
      {
        id: 10,
        senderId: 1,
        text: "Ugh, again? Thought we fixed that last sprint.",
        createdAt: hoursAgo(26.3),
      },
      {
        id: 11,
        senderId: CURRENT_USER_ID,
        text: "Different edge case — happens right after a password reset.",
        createdAt: hoursAgo(26.2),
      },
      {
        id: 12,
        senderId: 1,
        text: "Got it, I'll trace it this afternoon.",
        createdAt: hoursAgo(26),
      },
      {
        id: 13,
        senderId: CURRENT_USER_ID,
        text: "Thanks 🙌",
        createdAt: hoursAgo(25.8),
      },
      {
        id: 14,
        senderId: 1,
        text: "Found it — the reset token isn't cleared from storage after use.",
        createdAt: hoursAgo(25),
      },
      {
        id: 15,
        senderId: CURRENT_USER_ID,
        text: "Ah, classic. Straightforward fix?",
        createdAt: hoursAgo(24.8),
      },
      {
        id: 16,
        senderId: 1,
        text: "Yeah, one-liner plus a regression test.",
        createdAt: hoursAgo(24.6),
      },
      {
        id: 17,
        senderId: 1,
        text: "I'll bundle it with the service task branch.",
        createdAt: hoursAgo(24.5),
      },
      {
        id: 18,
        senderId: CURRENT_USER_ID,
        text: "Perfect. How's the PDF workaround coming along?",
        createdAt: hoursAgo(24.3),
      },
      {
        id: 19,
        senderId: 1,
        text: "Good — flattened the tables and rendering is clean now. Preview attached.",
        createdAt: hoursAgo(24.1),
        attachments: [{ file: "pdf-preview.png", fileSize: "1.2 MB" }],
      },
      {
        id: 20,
        senderId: 1,
        text: "Just need design to bless the spacing tweaks.",
        createdAt: hoursAgo(24),
      },
      {
        id: 21,
        senderId: CURRENT_USER_ID,
        text: "Cool. Ping me when the files are ready 🙏",
        createdAt: hoursAgo(23.8),
      },
      {
        id: 22,
        senderId: CURRENT_USER_ID,
        text: "Hey James, can you share the latest files for the service task?",
        createdAt: hoursAgo(2),
        attachments: [
          { file: "service-task.pdf", fileSize: "2 MB" },
          { file: "homepage-design.fig", fileSize: "3 MB" },
        ],
      },
      {
        id: 23,
        senderId: CURRENT_USER_ID,
        text: "Also let me know once the homepage review is done — no rush.",
        createdAt: minutesAgo(110),
      },
      {
        id: 24,
        senderId: 1,
        text: "Sure, sending it over in a minute.",
        createdAt: minutesAgo(45),
      },
      {
        id: 25,
        senderId: 1,
        text: "Just pushed the auth redirect fix as well.",
        createdAt: minutesAgo(44),
      },
      {
        id: 26,
        senderId: CURRENT_USER_ID,
        text: "Looks great, thanks!",
        createdAt: minutesAgo(30),
      },
    ],
  },
  {
    id: 2,
    name: "Maria Hernandez",
    email: "maria.hernandez@hyros.ai",
    role: "Product Designer",
    status: "away",
    messages: [
      {
        id: 1,
        senderId: 2,
        text: "The new onboarding mockups are in Figma.",
        createdAt: hoursAgo(3),
      },
      {
        id: 2,
        senderId: CURRENT_USER_ID,
        text: "Amazing — I'll review them this afternoon.",
        createdAt: minutesAgo(170),
      },
      {
        id: 3,
        senderId: 2,
        text: "Cool, ping me if anything is unclear.",
        createdAt: minutesAgo(165),
      },
    ],
  },
  {
    id: 3,
    name: "Priya Sharma",
    email: "priya.sharma@hyros.ai",
    role: "Data Analyst",
    status: "online",
    messages: [
      {
        id: 1,
        senderId: CURRENT_USER_ID,
        text: "Priya, do we have the attribution numbers for last week?",
        createdAt: hoursAgo(5),
      },
      {
        id: 2,
        senderId: 3,
        text: "Pulling them now — give me twenty minutes.",
        createdAt: minutesAgo(280),
      },
      {
        id: 3,
        senderId: 3,
        text: "Sent! ROAS is up 12% week over week. 🎉",
        createdAt: minutesAgo(260),
      },
    ],
  },
  {
    id: 4,
    name: "David Kim",
    email: "david.kim@hyros.ai",
    role: "Backend Engineer",
    status: "busy",
    messages: [
      {
        id: 1,
        senderId: 4,
        text: "Heads up: gateway deploy at 5pm today.",
        createdAt: hoursAgo(26),
      },
      {
        id: 2,
        senderId: CURRENT_USER_ID,
        text: "Ack — I'll hold the release queue.",
        createdAt: hoursAgo(25),
      },
      {
        id: 3,
        senderId: 4,
        text: "Deploy done, all green.",
        createdAt: hoursAgo(23),
        attachments: [{ file: "deploy-log.txt", fileSize: "84 KB" }],
      },
    ],
  },
  {
    id: 5,
    name: "Sofia Rossi",
    email: "sofia.rossi@hyros.ai",
    role: "Marketing Lead",
    status: "offline",
    messages: [
      {
        id: 1,
        senderId: 5,
        text: "Campaign copy draft is ready for review.",
        createdAt: daysAgo(2),
      },
      {
        id: 2,
        senderId: CURRENT_USER_ID,
        text: "On it — I'll send notes tomorrow morning.",
        createdAt: minutesAgo(2910),
      },
    ],
  },
  {
    id: 6,
    name: "Charles Martha",
    email: "charles.martha@hyros.ai",
    role: "Administrator",
    status: "online",
    messages: [
      {
        id: 1,
        senderId: CURRENT_USER_ID,
        text: "Charles, can you grant access to the new hire?",
        createdAt: daysAgo(3),
      },
      {
        id: 2,
        senderId: 6,
        text: "Done, access granted.",
        createdAt: minutesAgo(4290),
      },
    ],
  },
];
