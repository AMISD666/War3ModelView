import { useEffect } from 'react'
import MainLayoutNew from './components/MainLayoutNew'
import { initDebugLogging } from './utils/debugLog'

function App(): JSX.Element {
    useEffect(() => {
        initDebugLogging()
    }, [])

    return (
        <MainLayoutNew />
    )
}

export default App
