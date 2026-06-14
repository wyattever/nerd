
import unittest
from unittest.mock import MagicMock
from nerd_core.services import extract_grounding_urls

class TestServiceRobustness(unittest.TestCase):
    
    def test_extract_grounding_urls_safe_navigation(self):
        # Case 1: Empty response
        mock_resp = MagicMock()
        mock_resp.candidates = []
        self.assertEqual(extract_grounding_urls(mock_resp), [])
        
        # Case 2: No grounding metadata
        mock_resp = MagicMock()
        mock_resp.candidates = [MagicMock(spec=[])] # No grounding_metadata attr
        self.assertEqual(extract_grounding_urls(mock_resp), [])
        
        # Case 3: Grounding metadata is None
        mock_resp = MagicMock()
        mock_resp.candidates = [MagicMock()]
        mock_resp.candidates[0].grounding_metadata = None
        self.assertEqual(extract_grounding_urls(mock_resp), [])
        
        # Case 4: grounding_chunks is None
        mock_resp = MagicMock()
        mock_resp.candidates = [MagicMock()]
        mock_resp.candidates[0].grounding_metadata = MagicMock()
        mock_resp.candidates[0].grounding_metadata.grounding_chunks = None
        self.assertEqual(extract_grounding_urls(mock_resp), [])
        
        # Case 5: Valid grounding data
        mock_resp = MagicMock()
        chunk1 = MagicMock()
        chunk1.web.uri = "https://example.com/1"
        chunk2 = MagicMock()
        chunk2.web.uri = "https://example.com/2"
        mock_resp.candidates = [MagicMock()]
        mock_resp.candidates[0].grounding_metadata.grounding_chunks = [chunk1, chunk2]
        self.assertEqual(extract_grounding_urls(mock_resp), ["https://example.com/1", "https://example.com/2"])

if __name__ == "__main__":
    unittest.main()
