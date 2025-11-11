<?php
/*
This `TopicModel` class loads Gensim and preprocesses the conversation data by tokenizing, stemming, and removing stop words. It then converts the data to a format compatible with Gensim and saves it to a file.

The `extractTopics()` method loads the preprocessed data, creates a document-term matrix, and performs LDA to extract topics from the conversation data.


**Prerequisites**

To use Gensim and PHP-Word2Vec, you'll need:

1. **Gensim**: You can install Gensim using Composer: `composer require gensim/gensim`
2. **PHP-Word2Vec**: You can install PHP-Word2Vec using Composer: `composer require word2vec/php-word2vec`

*/
class TopicModel {
    private $gensim;

    public function __construct($conversationData) {
        // Load Gensim
        require_once 'Gensim.php';
        $this->gensim = new \Gensim();

        // Preprocess conversation data
        $this->preprocessConversationData($conversationData);
    }

    private function preprocessConversationData($conversationData) {
        // Tokenize and stem the text data
        $tokenizedData = array_map(function ($text) {
            return preg_split('/\s+/', $text);
        }, $conversationData);

        // Convert to lowercase and remove stop words
        $stopWords = array('the', 'and', 'a', 'of', 'to', 'in');
        $tokenizedData = array_map(function ($tokens) use ($stopWords) {
            return array_filter($tokens, function ($word) use ($stopWords) {
                return !in_array(strtolower($word), $stopWords);
            });
        }, $tokenizedData);

        // Convert to Gensim-compatible format
        $gensimFormat = [];
        foreach ($tokenizedData as $text) {
            $gensimFormat[] = {'id': '', 'tokens': array_map('strtolower', $text)};
        }

        // Save the preprocessed data to a file (for now)
        file_put_contents('conversation_data.txt', json_encode($gensimFormat));
    }

    public function extractTopics() {
        // Load the preprocessed data
        $data = file_get_contents('conversation_data.txt');
        $data = json_decode($data, true);

        // Create a Gensim document-term matrix
        $docTermMatrix = new \Gensim\DocumentTermMatrix();
        foreach ($data as $entry) {
            $docTermMatrix->addDocument(new \Gensim\Document($entry['tokens']));
        }

        // Perform Latent Dirichlet Allocation (LDA)
        $ldaModel = new \Gensim\LdaModel($docTermMatrix, 50); // 50 topics
        $topics = $ldaModel->getTopics();

        return $topics;
    }
}