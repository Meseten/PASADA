import TodaClient from "./TodaClient"

export function generateStaticParams() {
  return [
    { route: 'BATODA' }, { route: 'BBSTODA' }, { route: 'CNTODA' },
    { route: 'CO1TODA' }, { route: 'CO2TODA' }, { route: 'DOMMSATODA' },
    { route: 'HCTODA' }, { route: 'HMTODA' }, { route: 'HVRTODA' },
    { route: 'MALATODA' }, { route: 'MMGTODA' }, { route: 'MMTODA' },
    { route: 'NCTODA' }, { route: 'NPTODA' },{ route: 'PAL1TODA' }, 
    { route: 'PAL2TODA' }, { route: 'SABANGTODA' }, { route: 'SMSTODA' },
    { route: 'TCTODA' }, { route: 'VASTODA' }, { route: 'VISTODA' }
  ]
}

export default function TODALinePage() {
  return <TodaClient />
}