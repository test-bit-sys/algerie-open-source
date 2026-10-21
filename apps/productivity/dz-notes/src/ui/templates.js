/** Page templates (Insert > Page Templates). Outline HTML uses the normal note markup. */
const todo = (text) => `<p><span class="nt-tag" data-tag="todo" data-done="false" contenteditable="false"></span>${text}</p>`;
const today = () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export const TEMPLATES = [
  {
    id: 'blank',
    category: 'Blank',
    label: 'Blank page',
    desc: 'An empty page.',
    build: () => ({ title: '', outlines: [] }),
  },
  {
    id: 'meeting-simple',
    category: 'Business',
    label: 'Simple Meeting Notes',
    desc: 'Agenda, attendees, notes and action items.',
    build: () => ({
      title: 'Meeting Notes',
      outlines: [
        { x: 48, y: 140, w: 560, html: `<h2>Meeting Details</h2><p>Date: ${today()}</p><p>Location: </p><h2>Agenda</h2><ol><li><br></li></ol><h2>Attendees</h2><ul><li><br></li></ul><h2>Notes</h2><p><br></p><h2>Action Items</h2>${todo('')}` },
      ],
    }),
  },
  {
    id: 'meeting-detailed',
    category: 'Business',
    label: 'Detailed Meeting Notes',
    desc: 'Objective, discussion, decisions and follow-ups.',
    build: () => ({
      title: 'Project Meeting',
      outlines: [
        { x: 48, y: 140, w: 600, html: `<h2>Meeting Details</h2><table><tbody><tr><th>Date</th><td>${today()}</td></tr><tr><th>Time</th><td><br></td></tr><tr><th>Location</th><td><br></td></tr><tr><th>Facilitator</th><td><br></td></tr></tbody></table><h2>Objective</h2><p><br></p><h2>Discussion</h2><ul><li><br></li></ul><h2>Decisions</h2><ul><li><br></li></ul><h2>Follow-up</h2>${todo('')}<h2>Next Meeting</h2><p><br></p>` },
      ],
    }),
  },
  {
    id: 'todo',
    category: 'Planners',
    label: 'To Do List',
    desc: 'Prioritized checklist.',
    build: () => ({
      title: 'To Do List',
      outlines: [
        { x: 48, y: 140, w: 420, html: `<h3>High priority</h3>${todo('')}${todo('')}<h3>Medium priority</h3>${todo('')}${todo('')}<h3>Low priority</h3>${todo('')}` },
      ],
    }),
  },
  {
    id: 'weekly',
    category: 'Planners',
    label: 'Weekly Planner',
    desc: 'A table for each day of the week.',
    build: () => {
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      return {
        title: 'Weekly Planner',
        outlines: [{ x: 48, y: 140, w: 720, html: `<table><tbody><tr><th>Day</th><th>Plans</th><th>Notes</th></tr>${days.map((d) => `<tr><td>${d}</td><td><br></td><td><br></td></tr>`).join('')}</tbody></table>` }],
      };
    },
  },
  {
    id: 'project',
    category: 'Business',
    label: 'Project Overview',
    desc: 'Goals, milestones, team and risks.',
    build: () => ({
      title: 'Project Overview',
      outlines: [
        { x: 48, y: 140, w: 600, html: '<h2>Summary</h2><p><br></p><h2>Goals</h2><ul><li><br></li></ul><h2>Milestones</h2><table><tbody><tr><th>Milestone</th><th>Owner</th><th>Due</th><th>Status</th></tr><tr><td><br></td><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td><td><br></td></tr></tbody></table><h2>Team</h2><ul><li><br></li></ul><h2>Risks</h2><p><span class="nt-tag" data-tag="critical" contenteditable="false"></span><br></p>' },
      ],
    }),
  },
  {
    id: 'lecture',
    category: 'Academic',
    label: 'Lecture Notes',
    desc: 'Cue column, notes and summary.',
    build: () => ({
      title: 'Lecture Notes',
      outlines: [
        { x: 48, y: 140, w: 200, html: '<h3>Questions and cues</h3><p><span class="nt-tag" data-tag="question" contenteditable="false"></span><br></p>' },
        { x: 290, y: 140, w: 480, html: `<h3>Notes</h3><p>Course: </p><p>Date: ${today()}</p><p><br></p>` },
        { x: 48, y: 420, w: 722, html: '<h3>Summary</h3><p><br></p>' },
      ],
    }),
  },
  {
    id: 'journal',
    category: 'Personal',
    label: 'Daily Journal',
    desc: 'Gratitude, highlights and tomorrow.',
    build: () => ({
      title: today(),
      outlines: [
        { x: 48, y: 140, w: 520, html: '<h3>Today I am grateful for</h3><ul><li><br></li></ul><h3>Highlights</h3><p><br></p><h3>What I learned</h3><p><br></p><h3>Tomorrow</h3>' + todo('') },
      ],
    }),
  },
  {
    id: 'recipe',
    category: 'Personal',
    label: 'Recipe',
    desc: 'Ingredients and steps.',
    build: () => ({
      title: 'Recipe',
      outlines: [
        { x: 48, y: 140, w: 260, html: '<h3>Ingredients</h3><ul><li><br></li></ul>' },
        { x: 340, y: 140, w: 420, html: '<h3>Steps</h3><ol><li><br></li></ol><h3>Notes</h3><p><br></p>' },
      ],
    }),
  },
];
