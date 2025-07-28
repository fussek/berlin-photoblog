import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
// Import your new firebase config and firestore functions
import { db } from './firebase'; 
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';

// Helper function to shuffle an array (Fisher-Yates algorithm)
const shuffleArray = (array) => {
    let currentIndex = array.length, randomIndex;
    // While there remain elements to shuffle.
    while (currentIndex !== 0) {
        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
};

const PhotoItem = ({ photo, onClick }) => {
    const [hasAnimated, setHasAnimated] = useState(false);
    const itemRef = useRef(null);

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setHasAnimated(true);
                observer.unobserve(itemRef.current);
            }
        }, { threshold: 0.1 });

        const currentRef = itemRef.current;
        if (currentRef) {
            observer.observe(currentRef);
        }
        return () => {
            if (currentRef) observer.unobserve(currentRef);
        };
    }, []);

    const animationDelay = `${(photo.index % 3) * 0.15}s`;

    return (
        <div
            ref={itemRef}
            className={`photo-item ${hasAnimated ? 'slide-in' : ''}`}
            style={{ animationDelay }}
            // Use the photo's 'url' field from Firestore for the click handler
            onClick={() => onClick(photo.url)}
        >
            {/* Use the photo's 'url' and 'alt_description' fields */}
            <img src={photo.url} alt={photo.alt_description} />
        </div>
    );
};

const Modal = ({ imageUrl, onClose }) => {
    if (!imageUrl) return null;
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <button className="modal-close" onClick={onClose}>&times;</button>
                <img src={imageUrl} alt="Full size view" />
            </div>
        </div>
    );
};

const BATCH_SIZE = 12; // How many photos to load at a time

function App() {
    const [photos, setPhotos] = useState([]);
    const [shuffledPhotoIds, setShuffledPhotoIds] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [allLoaded, setAllLoaded] = useState(false);
    const [selectedImage, setSelectedImage] = useState(null);
    
    // --- FIX FOR RACE CONDITION ---
    // Use a ref as a synchronous lock to prevent multiple fetches from firing.
    const loadingRef = useRef(false);

    // Part 1: Fetch all document IDs and shuffle them once
    useEffect(() => {
        const fetchAllPhotoIds = async () => {
            setLoading(true);
            const photosCollection = collection(db, 'photos');
            const photoSnapshot = await getDocs(photosCollection);
            const ids = photoSnapshot.docs.map(d => d.id);
            setShuffledPhotoIds(shuffleArray(ids));
            setLoading(false);
        };
        fetchAllPhotoIds();
    }, []);

    // Part 2: Fetch the next batch of photos using the shuffled IDs
    const fetchPhotoBatch = useCallback(async () => {
        // Use the ref as a synchronous lock. If it's already loading or all photos are loaded, stop.
        if (loadingRef.current || allLoaded) return;
        
        // --- LOCK ---
        loadingRef.current = true;
        setLoading(true); // Set state for UI indicator

        try {
            const nextBatchIds = shuffledPhotoIds.slice(currentIndex, currentIndex + BATCH_SIZE);

            if (nextBatchIds.length === 0 && shuffledPhotoIds.length > 0) {
                setAllLoaded(true);
                return;
            }

            // Create an array of promises, each fetching one document
            const photoPromises = nextBatchIds.map(id => getDoc(doc(db, 'photos', id)));
            const photoDocs = await Promise.all(photoPromises);

            // Convert the documents to a usable format and add the animation index
            const newPhotos = photoDocs.map((d, i) => ({
                id: d.id,
                ...d.data(),
                index: currentIndex + i // For the staggered animation
            }));
            
            // This logic ensures that even if a batch is fetched twice,
            // we only add unique photos to the state.
            setPhotos(prevPhotos => {
                const existingIds = new Set(prevPhotos.map(p => p.id));
                const uniqueNewPhotos = newPhotos.filter(p => !existingIds.has(p.id));
                return [...prevPhotos, ...uniqueNewPhotos];
            });
            
            setCurrentIndex(prev => prev + BATCH_SIZE);
        } catch (error) {
            console.error("Error fetching photo batch from Firestore:", error);
        } finally {
            // --- UNLOCK ---
            // This 'finally' block ensures the lock is always released, even if an error occurs.
            setLoading(false);
            loadingRef.current = false;
        }
    }, [currentIndex, shuffledPhotoIds, allLoaded]);

    // This effect runs whenever the shuffled IDs are ready, to load the first batch
    useEffect(() => {
        if (shuffledPhotoIds.length > 0 && photos.length === 0) {
            fetchPhotoBatch();
        }
    }, [shuffledPhotoIds, photos.length, fetchPhotoBatch]);


    // This useEffect handles the infinite scroll logic.
    useEffect(() => {
        const handleScroll = () => {
            if (window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 500) {
                fetchPhotoBatch();
            }
        };
        window.addEventListener('scroll', handleScroll);
        // Cleanup function to remove the event listener when the component unmounts.
        return () => window.removeEventListener('scroll', handleScroll);
    }, [fetchPhotoBatch]);

    const handleImageClick = (imageUrl) => setSelectedImage(imageUrl);
    const handleCloseModal = () => setSelectedImage(null);

    return (
        <div className="App">
            <header className="App-header"><h1>Berlin</h1></header>
            <main className="photo-grid">
                {photos.map((photo) => (
                    <PhotoItem 
                        key={photo.id} 
                        photo={photo} 
                        onClick={handleImageClick}
                    />
                ))}
            </main>
            {loading && <p className="loading-indicator">Loading...</p>}
            {allLoaded && photos.length > 0 && <p className="loading-indicator">End of gallery.</p>}
            <Modal imageUrl={selectedImage} onClose={handleCloseModal} />
        </div>
    );
}

export default App;
