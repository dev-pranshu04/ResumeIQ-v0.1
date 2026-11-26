/**
 * Hand-labeled evaluation dataset for the JD Matcher retrieval pipeline.
 *
 * Each case pairs a resume with a set of requirement queries. For requirements the
 * resume genuinely supports, `expectedContentSubstring` identifies the "gold" chunk —
 * the eval runner finds the chunk containing that substring at run time (rather than a
 * hardcoded chunk id, since chunk ids are order-dependent and would make this dataset
 * brittle to unrelated chunker changes). For requirements the resume does NOT support,
 * `expectedContentSubstring` is omitted and `shouldMatch: false` records the correct
 * classification.
 *
 * This is a small, hand-authored set (not scraped/synthetic at scale) — enough to
 * produce real, meaningful numbers and catch real regressions (like the Stage 2
 * false-positive bug), while staying easy to audit by reading it.
 */

export interface EvalRequirement {
  requirement: string;
  shouldMatch: boolean;
  /** Required when shouldMatch is true; identifies the gold chunk by content substring. */
  expectedContentSubstring?: string;
}

export interface EvalCase {
  name: string;
  resume: string;
  requirements: EvalRequirement[];
}

export const EVAL_CASES: EvalCase[] = [
  {
    name: "backend-engineer",
    resume: `
EXPERIENCE

Senior Backend Engineer, Acme Corp
2021 - Present
- Designed and operated Kubernetes-based microservices handling 5M requests/day
- Migrated a legacy PHP monolith to Node.js and PostgreSQL, cutting p95 latency by 60%

Software Engineer, DataStream Inc
2018 - 2021
- Built real-time data pipelines using Apache Kafka and Python

PROJECTS

Open Source Rate Limiter
- Published an npm package implementing a distributed token-bucket rate limiter in Redis

SKILLS
Kubernetes, Docker, Node.js, PostgreSQL, Kafka, Python, Redis

EDUCATION
B.S. Computer Science, State University, 2018
`,
    requirements: [
      {
        requirement: "Strong experience with Kubernetes and container orchestration",
        shouldMatch: true,
        expectedContentSubstring: "Kubernetes-based microservices",
      },
      {
        requirement: "Experience building real-time data pipelines with Kafka",
        shouldMatch: true,
        expectedContentSubstring: "Apache Kafka",
      },
      {
        requirement: "Hands-on experience with Redis for caching or rate limiting",
        shouldMatch: true,
        expectedContentSubstring: "token-bucket rate limiter",
      },
      {
        requirement: "Experience with mobile app development using Swift or Kotlin",
        shouldMatch: false,
      },
      {
        requirement: "Background in graphic design and Adobe Creative Suite",
        shouldMatch: false,
      },
    ],
  },
  {
    name: "marketing-coordinator",
    resume: `
EXPERIENCE

Marketing Coordinator, Bright Startup Inc
2020 - Present
- Ran multi-channel email campaigns via HubSpot, growing the newsletter list by 40%
- Managed the company blog and coordinated with freelance writers on a weekly cadence

Marketing Intern, Local Agency
2019 - 2020
- Assisted with social media scheduling using Hootsuite

SKILLS
HubSpot, Hootsuite, Content Strategy, SEO Basics, Google Analytics

EDUCATION
B.A. Marketing, City University, 2020
`,
    requirements: [
      {
        requirement: "Experience running email marketing campaigns with a CRM like HubSpot",
        shouldMatch: true,
        expectedContentSubstring: "email campaigns via HubSpot",
      },
      {
        requirement: "Familiarity with social media scheduling tools",
        shouldMatch: true,
        expectedContentSubstring: "Hootsuite",
      },
      {
        requirement: "5+ years of experience with Kubernetes and distributed systems",
        shouldMatch: false,
      },
      {
        requirement: "Experience with underwater basket weaving",
        shouldMatch: false,
      },
    ],
  },
  {
    name: "ml-engineer",
    resume: `
EXPERIENCE

Machine Learning Engineer, Vision Labs
2022 - Present
- Trained and deployed computer vision models using PyTorch and served them via TorchServe
- Built a feature store on top of Snowflake for reuse across ML pipelines

Data Scientist, Insight Analytics
2020 - 2022
- Built churn-prediction models with scikit-learn, improving retention by 12%

PROJECTS

ResumeIQ
- Built an LLM-powered resume analyzer using TypeScript, React, and the Groq API

SKILLS
PyTorch, scikit-learn, Snowflake, Python, TypeScript, React

EDUCATION
M.S. Computer Science, Tech Institute, 2020
`,
    requirements: [
      {
        requirement: "Deep learning experience with PyTorch, including model deployment",
        shouldMatch: true,
        expectedContentSubstring: "PyTorch and served them via TorchServe",
      },
      {
        requirement: "Experience building predictive models with scikit-learn",
        shouldMatch: true,
        expectedContentSubstring: "churn-prediction models with scikit-learn",
      },
      {
        requirement: "Familiarity with LLM-powered application development",
        shouldMatch: true,
        expectedContentSubstring: "LLM-powered resume analyzer",
      },
      {
        requirement: "Experience with embedded systems and firmware in C",
        shouldMatch: false,
      },
      {
        requirement: "Background in corporate law or contract negotiation",
        shouldMatch: false,
      },
    ],
  },
  {
    name: "recent-grad-thin-resume",
    resume: `
EDUCATION
B.S. Information Technology, Community College, 2024

PROJECTS

Personal Portfolio Site
- Built a static site with HTML, CSS, and vanilla JavaScript

SKILLS
HTML, CSS, JavaScript, Git
`,
    requirements: [
      {
        requirement: "Experience with front-end web development using HTML, CSS, and JavaScript",
        shouldMatch: true,
        expectedContentSubstring: "HTML, CSS, and vanilla JavaScript",
      },
      {
        requirement: "5+ years of experience architecting large-scale distributed systems",
        shouldMatch: false,
      },
      {
        requirement: "Experience managing a team of engineers",
        shouldMatch: false,
      },
    ],
  },
  {
    name: "high-school-teacher",
    resume: `
EXPERIENCE

High School Mathematics Teacher, Lincoln High School
2019 - Present
- Taught Algebra II and AP Calculus to classes of 30+ students
- Designed a peer-tutoring program that raised the class pass rate by 15%

Student Teacher, Roosevelt Middle School
2018 - 2019
- Assisted lead teacher with lesson planning for a 7th-grade science curriculum

SKILLS
Classroom Management, Curriculum Design, Google Classroom, Differentiated Instruction

EDUCATION
B.A. Mathematics Education, State University, 2018
`,
    requirements: [
      {
        requirement: "Experience teaching high school mathematics, including AP-level courses",
        shouldMatch: true,
        expectedContentSubstring: "AP Calculus",
      },
      {
        requirement: "Experience designing curriculum or instructional programs",
        shouldMatch: true,
        expectedContentSubstring: "peer-tutoring program",
      },
      {
        requirement: "5+ years of experience as a backend software engineer",
        shouldMatch: false,
      },
      {
        requirement: "Experience with clinical patient care or nursing procedures",
        shouldMatch: false,
      },
    ],
  },
  {
    name: "registered-nurse",
    resume: `
EXPERIENCE

Registered Nurse, City General Hospital
2020 - Present
- Provided direct patient care in a 30-bed medical-surgical unit
- Administered medications and monitored vitals for up to 8 patients per shift
- Trained incoming nurses on the hospital's electronic health record (Epic) system

Nursing Assistant, Sunrise Care Home
2018 - 2020
- Assisted residents with daily living activities and vital sign monitoring

SKILLS
Patient Care, Epic EHR, IV Therapy, Vital Signs Monitoring, HIPAA Compliance

EDUCATION
B.S. Nursing, State University, 2018
RN License, active
`,
    requirements: [
      {
        requirement: "Experience providing direct patient care in a hospital setting",
        shouldMatch: true,
        expectedContentSubstring: "30-bed medical-surgical unit",
      },
      {
        requirement: "Familiarity with Epic or similar electronic health record systems",
        shouldMatch: true,
        expectedContentSubstring: "electronic health record (Epic)",
      },
      {
        requirement: "Experience with Python and data analysis for financial modeling",
        shouldMatch: false,
      },
      {
        requirement: "Background in graphic design or brand identity work",
        shouldMatch: false,
      },
    ],
  },
  {
    name: "product-manager",
    resume: `
EXPERIENCE

Senior Product Manager, CloudSuite Inc
2021 - Present
- Owned the roadmap for a B2B SaaS analytics product used by 200+ enterprise customers
- Ran quarterly customer interviews to prioritize the feature backlog, informed by usage data from Amplitude
- Partnered with engineering to ship a self-serve onboarding flow that cut time-to-first-value by 35%

Associate Product Manager, StartupCo
2019 - 2021
- Wrote PRDs and coordinated cross-functional launches with design and engineering

SKILLS
Product Roadmapping, Amplitude, SQL, A/B Testing, Stakeholder Management

EDUCATION
B.S. Business Administration, State University, 2019
`,
    requirements: [
      {
        requirement: "Experience owning a product roadmap for a B2B SaaS product",
        shouldMatch: true,
        expectedContentSubstring: "roadmap for a B2B SaaS analytics product",
      },
      {
        requirement: "Data-informed decision making using analytics tools like Amplitude",
        shouldMatch: true,
        expectedContentSubstring: "usage data from Amplitude",
      },
      {
        requirement: "Hands-on experience writing production Java or C++ code",
        shouldMatch: false,
      },
      {
        requirement: "Experience with warehouse logistics and supply chain operations",
        shouldMatch: false,
      },
    ],
  },
  {
    name: "sales-representative",
    resume: `
EXPERIENCE

Account Executive, BrightSoft
2020 - Present
- Closed $1.2M in new annual recurring revenue against a $900K quota
- Managed a pipeline of 40+ mid-market accounts using Salesforce
- Ran product demos and negotiated multi-year contracts with procurement teams

Sales Development Representative, BrightSoft
2019 - 2020
- Generated qualified pipeline through cold outreach and inbound follow-up

SKILLS
Salesforce, Solution Selling, Contract Negotiation, Pipeline Management

EDUCATION
B.A. Communications, State University, 2019
`,
    requirements: [
      {
        requirement: "Proven track record of exceeding sales quota in a B2B environment",
        shouldMatch: true,
        expectedContentSubstring: "against a $900K quota",
      },
      {
        requirement: "Experience managing a pipeline in Salesforce",
        shouldMatch: true,
        expectedContentSubstring: "40+ mid-market accounts using Salesforce",
      },
      {
        requirement: "Experience with mechanical CAD design and manufacturing tolerances",
        shouldMatch: false,
      },
      {
        requirement: "Background in nursing or clinical healthcare",
        shouldMatch: false,
      },
    ],
  },
  {
    name: "mechanical-engineer",
    resume: `
EXPERIENCE

Mechanical Design Engineer, Precision Robotics Co
2020 - Present
- Designed sheet-metal and machined components for robotic arms using SolidWorks
- Ran FEA stress simulations to validate part designs before prototyping
- Reduced assembly cost by 18% through a DFM redesign of a gripper subassembly

Mechanical Engineering Intern, AutoParts Inc
2019 - 2020
- Supported tolerance-stack analysis for automotive suspension components

SKILLS
SolidWorks, FEA, GD&T, DFM, Sheet Metal Design

EDUCATION
B.S. Mechanical Engineering, State University, 2020
`,
    requirements: [
      {
        requirement: "Experience with SolidWorks for mechanical component design",
        shouldMatch: true,
        expectedContentSubstring: "using SolidWorks",
      },
      {
        requirement: "Experience running FEA simulations to validate designs",
        shouldMatch: true,
        expectedContentSubstring: "FEA stress simulations",
      },
      {
        requirement: "Experience with enterprise sales and quota attainment",
        shouldMatch: false,
      },
      {
        requirement: "Experience teaching or tutoring students",
        shouldMatch: false,
      },
    ],
  },
];
